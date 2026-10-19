/**
 * Messwerkzeug für den Sprach-Testsatz (tests/sprache/befehle.json): Misst die Trefferquote eines KI-Anbieters
 * auf 50 Testbefehlen. Treffer = Aktion stimmt UND alle erwarteten Kernfelder stimmen (siehe bewertung.ts).
 *
 * Aufruf:  npm run sprache:messen -- --anbieter=fake|mistral [--audio]
 *   --anbieter=fake      regelbasierte Test-KI (Standard)
 *   --anbieter=mistral   echte Mistral-KI (braucht CRM_MISTRAL_KEY)
 *   --audio              Audiodateien über den STT-Dienst transkribieren statt den Textsatz nehmen
 *                        (braucht crm-stt per CRM_STT_URL)
 *
 * Ausgabe: Tabelle je Befehl (Nr, Aktion, Ergebnis) + Zusammenfassung je Aktion und Gesamtquote.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { MistralKi } from '../../src/lib/server/ki/mistral';
import { pruefeAktion, type KiAktion } from '../../src/lib/server/sprache/aktionen';
import { transkribiere } from '../../src/lib/server/sprache/stt';
import { bewerte, ladeTestsatz, type Befehl } from './bewertung';

type Args = { anbieter: 'fake' | 'mistral'; audio: boolean };

function parseArgs(argv: string[]): Args {
	const args: Args = { anbieter: 'fake', audio: false };
	for (const a of argv) {
		if (a === '--audio') args.audio = true;
		else if (a.startsWith('--anbieter=')) {
			const w = a.slice('--anbieter='.length);
			if (w === 'fake' || w === 'mistral') args.anbieter = w;
			else throw new Error(`Unbekannter Anbieter: ${w} (erlaubt: fake, mistral)`);
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
	const ki =
		args.anbieter === 'mistral'
			? new MistralKi({ schluessel: process.env.CRM_MISTRAL_KEY ?? '' })
			: new FakeKi();

	console.log(`Sprach-Testsatz: ${satz.befehle.length} Befehle · Anbieter: ${ki.name}${args.audio ? ' · Audio via STT' : ' · Textsatz'}\n`);

	const zeilen: { nr: number; aktion: string; treffer: boolean; hinweis: string }[] = [];
	for (const b of satz.befehle) {
		const text = await holeText(b, args.audio);
		let ist: KiAktion;
		try {
			ist = pruefeAktion(await ki.aktionAusText(text, { heute: satz.heute, wochentag: satz.wochentag }));
		} catch (e) {
			zeilen.push({ nr: b.nr, aktion: b.erwartet.aktion, treffer: false, hinweis: `KI-Fehler: ${(e as Error).message}` });
			continue;
		}
		const e = bewerte(b.erwartet, ist);
		zeilen.push({
			nr: b.nr,
			aktion: b.erwartet.aktion,
			treffer: e.treffer,
			hinweis: e.treffer ? '' : e.abweichungen.join('; ')
		});
	}

	// Tabelle
	const kopf = 'Nr  Aktion              Treffer  Hinweis';
	console.log(kopf);
	console.log('-'.repeat(80));
	for (const z of zeilen) {
		const nr = String(z.nr).padStart(2);
		const ak = z.aktion.padEnd(20);
		const tr = z.treffer ? '✓' : '✗';
		console.log(`${nr}  ${ak} ${tr}      ${z.hinweis}`);
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
	if (gesamtTreffer / zeilen.length < 0.9) {
		console.log('⚠ Unter 90 % – Pflichtenheft verlangt ≥ 90 %');
		process.exitCode = 1;
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
