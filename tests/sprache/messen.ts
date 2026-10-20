/**
 * Messwerkzeug für den Sprach-Testsatz (tests/sprache/befehle.json): Misst die Trefferquote eines KI-Anbieters
 * auf 50 Testbefehlen. Treffer = Aktion stimmt UND alle erwarteten Kernfelder stimmen (siehe bewertung.ts).
 *
 * Aufruf:  npm run sprache:messen -- --anbieter=fake|mistral|openai-kompatibel [--audio] [--nur=1,5,9]
 *   --anbieter=fake      regelbasierte Test-KI (Standard)
 *   --anbieter=mistral   echte Mistral-KI (braucht CRM_MISTRAL_KEY)
 *   --anbieter=openai-kompatibel  z. B. MiMo (braucht CRM_KI_URL, CRM_KI_KEY, CRM_KI_MODELL; siehe anbieter.ts)
 *   --nur=…              nur diese Befehlsnummern
 *   --audio              Audiodateien über den STT-Dienst transkribieren statt den Textsatz nehmen
 *                        (braucht crm-stt per CRM_STT_URL)
 *
 * Ausgabe: Tabelle je Befehl (Nr, Aktion, Ergebnis, Dauer) + Zusammenfassung je Aktion, Gesamtquote, Ø-Dauer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { MistralKi } from '../../src/lib/server/ki/mistral';
import { waehleAnbieter } from '../../src/lib/server/ki/anbieter';
import { pruefeAktion, type KiAktion } from '../../src/lib/server/sprache/aktionen';
import { transkribiere } from '../../src/lib/server/sprache/stt';
import { bewerte, ladeTestsatz, type Befehl } from './bewertung';

type Args = { anbieter: 'fake' | 'mistral' | 'openai-kompatibel'; audio: boolean; nur: number[] | null };

function parseArgs(argv: string[]): Args {
	const args: Args = { anbieter: 'fake', audio: false, nur: null };
	for (const a of argv) {
		if (a === '--audio') args.audio = true;
		else if (a.startsWith('--nur=')) args.nur = a.slice('--nur='.length).split(',').map(Number).filter(Number.isFinite);
		else if (a.startsWith('--anbieter=')) {
			const w = a.slice('--anbieter='.length);
			if (w === 'fake' || w === 'mistral' || w === 'openai-kompatibel') args.anbieter = w;
			else throw new Error(`Unbekannter Anbieter: ${w} (erlaubt: fake, mistral, openai-kompatibel)`);
		}
	}
	return args;
}

async function holeText(b: Befehl, audio: boolean): Promise<string> {
	if (!audio) return b.text;
	const pfad = join(import.meta.dirname ?? '.', b.audio);
	const bytes = new Uint8Array(readFileSync(pfad));
	const { text } = await transkribiere(bytes, 'audio/wav');
	return text;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const satz = ladeTestsatz();
	if (args.nur) satz.befehle = satz.befehle.filter((b) => args.nur!.includes(b.nr));
	const ki =
		args.anbieter === 'mistral'
			? new MistralKi({ schluessel: process.env.CRM_MISTRAL_KEY ?? '' })
			: args.anbieter === 'openai-kompatibel'
				? waehleAnbieter({ ...process.env, CRM_KI_ANBIETER: 'openai-kompatibel' })
				: new FakeKi();
	if (args.anbieter !== 'fake' && ki.name === 'fake') throw new Error(`${args.anbieter}: Umgebung unvollständig`);

	const modell = 'modellSchnell' in ki ? ` (${String((ki as { modellSchnell: string }).modellSchnell)})` : '';
	console.log(`Sprach-Testsatz: ${satz.befehle.length} Befehle · Anbieter: ${ki.name}${modell}${args.audio ? ' · Audio via STT' : ' · Textsatz'}\n`);

	const zeilen: { nr: number; aktion: string; treffer: boolean; hinweis: string; ms: number }[] = [];
	for (const b of satz.befehle) {
		const text = await holeText(b, args.audio);
		let ist: KiAktion;
		const start = performance.now();
		try {
			ist = pruefeAktion(await ki.aktionAusText(text, { heute: satz.heute, wochentag: satz.wochentag }));
		} catch (e) {
			const ms = performance.now() - start;
			zeilen.push({ nr: b.nr, aktion: b.erwartet.aktion, treffer: false, hinweis: `KI-Fehler: ${(e as Error).message}`, ms });
			continue;
		}
		const ms = performance.now() - start;
		const e = bewerte(b.erwartet, ist);
		zeilen.push({
			nr: b.nr,
			aktion: b.erwartet.aktion,
			treffer: e.treffer,
			hinweis: e.treffer ? '' : e.abweichungen.join('; '),
			ms
		});
	}

	// Tabelle
	const kopf = 'Nr  Aktion              Treffer  Dauer   Hinweis';
	console.log(kopf);
	console.log('-'.repeat(80));
	for (const z of zeilen) {
		const nr = String(z.nr).padStart(2);
		const ak = z.aktion.padEnd(20);
		const tr = z.treffer ? '✓' : '✗';
		console.log(`${nr}  ${ak} ${tr}      ${(z.ms / 1000).toFixed(1).padStart(4)} s  ${z.hinweis}`);
	}

	// Zusammenfassung
	const aktionsListe = [...new Set(satz.befehle.map((b) => b.erwartet.aktion))];
	let gesamtTreffer = 0;
	console.log('\nZusammenfassung:');
	for (const a of aktionsListe) {
		const gruppe = zeilen.filter((z) => z.aktion === a);
		const tr = gruppe.filter((z) => z.treffer).length;
		gesamtTreffer += tr;
		const proz = ((tr / gruppe.length) * 100).toFixed(1);
		console.log(`  ${a.padEnd(20)} ${tr}/${gruppe.length} (${proz} %)`);
	}
	const gesamt = ((gesamtTreffer / zeilen.length) * 100).toFixed(1);
	console.log(`\nGesamtquote: ${gesamtTreffer}/${zeilen.length} = ${gesamt} %`);
	const dauern = zeilen.map((z) => z.ms).sort((a, b) => a - b);
	const mittel = dauern.reduce((a, b) => a + b, 0) / Math.max(1, dauern.length);
	const median = dauern[Math.floor(dauern.length / 2)] ?? 0;
	console.log(`Dauer: Ø ${(mittel / 1000).toFixed(2)} s · Median ${(median / 1000).toFixed(2)} s · max ${((dauern.at(-1) ?? 0) / 1000).toFixed(2)} s`);
	if (gesamtTreffer / zeilen.length < 0.9) {
		console.log('⚠ Unter 90 % – Pflichtenheft verlangt ≥ 90 %');
		process.exitCode = 1;
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
