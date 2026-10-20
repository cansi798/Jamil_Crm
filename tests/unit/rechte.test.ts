import { describe, expect, it } from 'vitest';
import { hatRecht, pruefeRecht, RECHTE, VORLAGEN } from '../../src/lib/server/rechte';
import { alsAntwort, ApiFehler } from '../../src/lib/server/fehler';

const nutzer = (rechte: string[], extra: Partial<Nutzer> = {}): Nutzer => ({
	id: 'n1',
	betriebId: 'b1',
	istAdmin: false,
	rechte,
	betriebStatus: 'aktiv',
	...extra
});

describe('Rechte und Vorlagen', () => {
	it('RECHTE enthält genau die vierzehn Rechte mit deutschen Beschriftungen', () => {
		expect(Object.keys(RECHTE)).toEqual([
			'kunden.lesen',
			'kunden.bearbeiten',
			'auftraege.lesen',
			'auftraege.alle_lesen',
			'todos.alle_lesen',
			'auftraege.bearbeiten',
			'plantafel.bearbeiten',
			'angebote.bearbeiten',
			'preise.sehen',
			'katalog.bearbeiten',
			'protokolle.lesen',
			'protokolle.bearbeiten',
			'protokolle.ausfuellen',
			'protokolle.vorlagen_bearbeiten',
			'erinnerungen.nutzen',
			'buchung.verwalten',
			'zeiten.erfassen',
			'zeiten.verwalten',
			'benutzer.verwalten',
			'einstellungen'
		]);
		for (const label of Object.values(RECHTE)) expect(label.trim().length).toBeGreaterThan(2);
	});

	it('Vorlage monteur hat kein preise.sehen', () => {
		expect(VORLAGEN.monteur).toEqual(['kunden.lesen', 'auftraege.lesen', 'protokolle.ausfuellen', 'erinnerungen.nutzen', 'zeiten.erfassen']);
		expect(VORLAGEN.monteur).not.toContain('preise.sehen');
	});

	it('Vorlage chef hat alle Rechte', () => {
		expect([...VORLAGEN.chef].sort()).toEqual(Object.keys(RECHTE).sort());
	});

	it('Vorlage buero hat alle außer einstellungen, benutzer.verwalten und buchung.verwalten', () => {
		expect(VORLAGEN.buero).not.toContain('einstellungen');
		expect(VORLAGEN.buero).not.toContain('benutzer.verwalten');
		expect(VORLAGEN.buero).not.toContain('buchung.verwalten');
		expect(VORLAGEN.buero).toHaveLength(Object.keys(RECHTE).length - 3);
		for (const r of VORLAGEN.buero) expect(Object.keys(RECHTE)).toContain(r);
	});

	it('hatRecht prüft die Rechte des Nutzers', () => {
		expect(hatRecht(nutzer(['kunden.lesen']), 'kunden.lesen')).toBe(true);
		expect(hatRecht(nutzer(['kunden.lesen']), 'preise.sehen')).toBe(false);
		expect(hatRecht(nutzer([]), 'einstellungen')).toBe(false);
	});

	it('pruefeRecht wirft 403 ohne Recht, 401 ohne Anmeldung und läuft sonst durch', () => {
		expect(() => pruefeRecht({ nutzer: nutzer(['einstellungen']) }, 'einstellungen')).not.toThrow();
		let fehler: unknown;
		try {
			pruefeRecht({ nutzer: nutzer(['kunden.lesen']) }, 'einstellungen');
		} catch (e) {
			fehler = e;
		}
		expect(fehler).toBeInstanceOf(ApiFehler);
		expect(fehler).toMatchObject({ status: 403, message: 'Keine Berechtigung' });
		expect(() => pruefeRecht({ nutzer: null }, 'einstellungen')).toThrow(
			expect.objectContaining({ status: 401 })
		);
	});
});

describe('Fehlerantworten', () => {
	it('ApiFehler wird zu { fehler } mit dem Status', async () => {
		const r = alsAntwort(new ApiFehler(409, 'Schon vorhanden'));
		expect(r.status).toBe(409);
		expect(r.headers.get('content-type')).toContain('application/json');
		expect(await r.json()).toEqual({ fehler: 'Schon vorhanden' });
	});

	it('unbekannte Fehler (z. B. SQL) werden nie ausgegeben, sondern als allgemeine 500 beantwortet', async () => {
		const log = console.error;
		const geloggt: unknown[][] = [];
		console.error = (...a: unknown[]) => void geloggt.push(a);
		try {
			const r = alsAntwort(new Error('relation "app.geheim" does not exist'));
			expect(r.status).toBe(500);
			const text = await r.text();
			expect(text).not.toContain('geheim');
			expect(JSON.parse(text)).toEqual({ fehler: 'Interner Fehler. Bitte später erneut versuchen.' });
			expect(geloggt.length).toBe(1);
		} finally {
			console.error = log;
		}
	});
});
