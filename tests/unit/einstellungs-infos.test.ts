import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INFOS } from '../../src/lib/einstellungs-infos';
import { FUNKTIONEN, nachSchritt, SCHRITTE, sichtbareFunktionen } from '../../src/lib/funktionen';
import { NEUIGKEITEN, sichtbareNeuigkeiten } from '../../src/lib/neuigkeiten';
import { baueNavigation } from '../../src/lib/navigation';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

/** Info-Fenster ⓘ, Funktionen & Automatisierungen, Was ist neu (Jamil, Talk msg 3423). */
function dateien(ordner: string, endung: RegExp): string[] {
	return readdirSync(ordner).flatMap((n) => {
		const p = join(ordner, n);
		return statSync(p).isDirectory() ? dateien(p, endung) : endung.test(n) ? [p] : [];
	});
}
const QUELLEN = dateien('src', /\.(svelte|ts)$/).filter((p) => !p.endsWith('einstellungs-infos.ts'));
const inhalt = (p: string) => readFileSync(p, 'utf8');

/** Schlüssel, die Seiten benutzen: <InfoFenster id="…">, info="…" an Bausteinen, info: '…' in Listen */
function benutzteSchluessel(): Map<string, string[]> {
	const m = new Map<string, string[]>();
	for (const p of QUELLEN) {
		const t = inhalt(p);
		for (const re of [/<Info(?:Fenster|Feld)\s+id="([\w.-]+)"/g, /\binfo="([\w-]+\.[\w.-]+)"/g, /\binfo:\s*'([\w-]+\.[\w.-]+)'/g, /'([\w-]+\.(?:seite|je_auftrag))'/g]) {
			for (const x of t.matchAll(re)) m.set(x[1], [...(m.get(x[1]) ?? []), p]);
		}
	}
	return m;
}

describe('Info-Texte', () => {
	it('jeder Eintrag hat alle vier Teile, verständlich kurz', () => {
		for (const [id, i] of Object.entries(INFOS)) {
			for (const feld of ['titel', 'was', 'wirkt', 'standard', 'beispiel'] as const) {
				expect(i[feld].trim().length, `${id}.${feld}`).toBeGreaterThan(2);
				expect(i[feld].length, `${id}.${feld} zu lang`).toBeLessThanOrEqual(330);
			}
		}
	});

	it('jeder benutzte Schlüssel hat einen Text; jeder Text wird benutzt', () => {
		const benutzt = benutzteSchluessel();
		for (const k of benutzt.keys()) expect(Object.keys(INFOS), `Text fehlt: ${k}`).toContain(k);
		for (const k of Object.keys(INFOS)) expect([...benutzt.keys()], `Text ungenutzt: ${k}`).toContain(k);
	});

	it('jede Einstellungsseite hat mindestens ein Info-Fenster', () => {
		const seiten = [
			...dateien('src/routes/(app)/einstellungen', /^\+page\.svelte$/).filter((p) => !/\[id\]|[\\/]neu[\\/]|[\\/]funktionen[\\/]/.test(p)),
			'src/routes/(app)/kalkulation/+page.svelte',
			'src/routes/(app)/konto/benachrichtigungen/+page.svelte',
			'src/routes/(app)/konto/handy/+page.svelte',
			'src/routes/(app)/einstellungen/funktionen/+page.svelte'
		];
		// Vorlagen-Seiten laufen über gemeinsame Köpfe (VorlagenKopf mit info)
		const ueberGemeinsam = ['protokoll-vorlagen', 'aufmass-vorlagen'];
		for (const p of seiten) {
			if (ueberGemeinsam.some((x) => p.includes(x))) continue;
			expect(/InfoFenster|\binfo=/.test(inhalt(p)), `${p} ohne Info-Fenster`).toBe(true);
		}
		expect(inhalt('src/lib/components/vorlagen/FormularVorlagenListe.svelte')).toMatch(/info=/);
	});
});

describe('Funktionen & Automatisierungen', () => {
	it('eindeutige Schlüssel, Pflichtfelder, bekannte Info-Schlüssel', () => {
		expect(new Set(FUNKTIONEN.map((f) => f.id)).size).toBe(FUNKTIONEN.length);
		for (const f of FUNKTIONEN) {
			expect(f.name && f.was && f.wann && f.href && f.recht, f.id).toBeTruthy();
			expect(SCHRITTE.map((s) => s.id)).toContain(f.schritt);
			if (f.info) expect(Object.keys(INFOS), f.id).toContain(f.info);
			if (f.schalter) expect(['ab_automatisch', 'bestand_aktiv']).toContain(f.zustand);
		}
	});

	it('jeder Link führt zu einem Menüpunkt', () => {
		const nav = baueNavigation({ istAdmin: false, betriebId: 'b', rechte: VORLAGEN.chef }, [...MODULE]);
		const ziele = new Set([...nav.haupt, ...nav.mehr].map((e) => e.href));
		for (const f of FUNKTIONEN) expect(ziele.has(f.href), `${f.id} → ${f.href}`).toBe(true);
	});

	it('nach Recht und Modul gefiltert, nach dem Kundenweg geordnet', () => {
		const chef = sichtbareFunktionen({ rechte: VORLAGEN.chef }, [...MODULE]);
		expect(nachSchritt(chef).map((g) => g.schritt.id)).toEqual(['anfrage', 'angebot', 'auftrag', 'abschluss', 'danach']);
		expect(sichtbareFunktionen({ rechte: [] }, [...MODULE])).toEqual([]);
		const ohnePortal = sichtbareFunktionen({ rechte: VORLAGEN.chef }, MODULE.filter((m) => m !== 'kundenportal')).map((f) => f.id);
		expect(ohnePortal).not.toContain('kundenportal');
		expect(ohnePortal).not.toContain('bestandskarte');
		expect(ohnePortal).toContain('ab-automatisch');
	});
});

describe('Was ist neu', () => {
	it('neueste zuerst, Pflichtfelder, Links im Haus', () => {
		for (const n of NEUIGKEITEN) {
			expect(n.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(n.titel && n.satz && n.wo).toBeTruthy();
			expect(n.href.startsWith('/')).toBe(true);
		}
		const daten = NEUIGKEITEN.map((n) => n.datum);
		expect(daten).toEqual([...daten].sort().reverse());
	});

	it('blendet aus, was der Nutzer nicht öffnen kann', () => {
		const monteur = sichtbareNeuigkeiten({ rechte: VORLAGEN.monteur }, [...MODULE]).map((n) => n.titel);
		expect(monteur).not.toContain('Leistungen für Bestandskunden');
		expect(sichtbareNeuigkeiten({ rechte: VORLAGEN.chef }, [...MODULE]).map((n) => n.titel)).toContain('Leistungen für Bestandskunden');
		expect(sichtbareNeuigkeiten({ rechte: VORLAGEN.chef }, MODULE.filter((m) => m !== 'kundenportal')).map((n) => n.titel)).not.toContain('Leistungen für Bestandskunden');
	});
});
