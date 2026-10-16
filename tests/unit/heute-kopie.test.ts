import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	gemerkterNutzer,
	lade,
	loesche,
	merkeNutzer,
	nutzerKennung,
	SCHLUESSEL,
	speichere,
	type HeuteEinsatz
} from '../../src/lib/heute-kopie';
import { berlinZeitpunkt } from '../../src/lib/zeit';

/** Kleiner localStorage-Ersatz für Node. */
class Speicher {
	daten = new Map<string, string>();
	getItem(k: string) {
		return this.daten.has(k) ? this.daten.get(k)! : null;
	}
	setItem(k: string, v: string) {
		this.daten.set(k, String(v));
	}
	removeItem(k: string) {
		this.daten.delete(k);
	}
}

const EINSATZ: HeuteEinsatz = {
	id: 'e1',
	beginn: '2026-10-21T06:00:00.000Z',
	ende: '2026-10-21T10:00:00.000Z',
	auftragId: 'a1',
	auftragNummer: 'A-2026-0001',
	auftragTitel: 'Badsanierung',
	kundeName: 'Müller',
	ort: 'Hauptstraße 1, 20095 Hamburg',
	notiz: 'Schlüssel beim Nachbarn'
};

describe('Offline-Kopie „Meine Einsätze heute“', () => {
	let speicher: Speicher;
	beforeEach(() => {
		speicher = new Speicher();
		(globalThis as any).localStorage = speicher;
	});
	afterEach(() => {
		delete (globalThis as any).localStorage;
	});

	it('Kopie von heute → Einträge zurück, mit Stand und Benutzer', () => {
		const jetzt = berlinZeitpunkt('2026-10-21', 7, 15);
		speichere('b1', '2026-10-21', [EINSATZ], jetzt);
		const k = lade(berlinZeitpunkt('2026-10-21', 18, 0), nutzerKennung('b1'));
		expect(k).toEqual({ benutzerId: 'b1', tag: '2026-10-21', stand: jetzt.toISOString(), einsaetze: [EINSATZ] });
	});

	it('Kopie von gestern → lade liefert null und entfernt den Schlüssel', () => {
		speichere('b1', '2026-10-20', [EINSATZ], berlinZeitpunkt('2026-10-20', 7));
		expect(speicher.getItem(SCHLUESSEL)).not.toBeNull();
		expect(lade(berlinZeitpunkt('2026-10-21', 0, 5), nutzerKennung('b1'))).toBeNull();
		expect(speicher.getItem(SCHLUESSEL)).toBeNull();
	});

	it('loesche entfernt die Kopie', () => {
		speichere('b1', '2026-10-21', [EINSATZ], berlinZeitpunkt('2026-10-21', 7));
		loesche();
		expect(speicher.getItem(SCHLUESSEL)).toBeNull();
		expect(lade(berlinZeitpunkt('2026-10-21', 8), nutzerKennung('b1'))).toBeNull();
	});

	it('speichert nur die erlaubten Felder (keine Preise o. Ä.)', () => {
		const mitMehr = { ...EINSATZ, preis: 1234, warnungen: [{ art: 'doppelt' }], benutzerName: 'Ali' } as never;
		speichere('b1', '2026-10-21', [mitMehr], berlinZeitpunkt('2026-10-21', 7));
		const roh = JSON.parse(speicher.getItem(SCHLUESSEL)!);
		expect(Object.keys(roh.einsaetze[0]).sort()).toEqual(Object.keys(EINSATZ).sort());
		expect(speicher.getItem(SCHLUESSEL)).not.toContain('1234');
	});

	it('kaputte Daten oder fehlender Speicher → null, keine Ausnahme', () => {
		speicher.setItem(SCHLUESSEL, '{kaputt');
		expect(lade(new Date(), nutzerKennung('b1'))).toBeNull();
		expect(speicher.getItem(SCHLUESSEL)).toBeNull();
		speicher.setItem(SCHLUESSEL, JSON.stringify({ tag: '2026-10-21', einsaetze: 'nein' }));
		expect(lade(berlinZeitpunkt('2026-10-21', 9), nutzerKennung('b1'))).toBeNull();
		delete (globalThis as any).localStorage;
		expect(() => speichere('b1', '2026-10-21', [EINSATZ], new Date())).not.toThrow();
		expect(lade(new Date(), nutzerKennung('b1'))).toBeNull();
		expect(() => loesche()).not.toThrow();
	});

	it('Kopie gehört einem anderen Benutzer → lade liefert null und löscht sie (geteiltes Tablet)', () => {
		const jetzt = berlinZeitpunkt('2026-10-21', 7);
		speichere('monteur-a', '2026-10-21', [EINSATZ], jetzt);
		expect(lade(jetzt, nutzerKennung('monteur-a'))).not.toBeNull();
		expect(lade(jetzt, nutzerKennung('monteur-b'))).toBeNull();
		expect(speicher.getItem(SCHLUESSEL)).toBeNull();
		// ohne bekannten Benutzer gibt es keine Kopie
		speichere('monteur-a', '2026-10-21', [EINSATZ], jetzt);
		expect(lade(jetzt, null)).toBeNull();
	});

	it('merkeNutzer: anderer Benutzer meldet sich an → fremde Kopie wird sofort gelöscht; Merker ohne Klartext-ID', () => {
		const jetzt = berlinZeitpunkt('2026-10-21', 7);
		speichere('11111111-1111-4111-8111-111111111111', '2026-10-21', [EINSATZ], jetzt);
		expect(gemerkterNutzer()).toBe(nutzerKennung('11111111-1111-4111-8111-111111111111'));
		expect(JSON.stringify([...speicher.daten.entries()].filter(([k]) => k !== SCHLUESSEL))).not.toContain('1111');
		merkeNutzer(nutzerKennung('11111111-1111-4111-8111-111111111111'));
		expect(speicher.getItem(SCHLUESSEL)).not.toBeNull();
		merkeNutzer(nutzerKennung('22222222-2222-4222-8222-222222222222'));
		expect(speicher.getItem(SCHLUESSEL)).toBeNull();
		expect(gemerkterNutzer()).toBe(nutzerKennung('22222222-2222-4222-8222-222222222222'));
		expect(lade(jetzt, gemerkterNutzer())).toBeNull();
	});

	it('veraltete Kopie (gestern) wird auch mit passendem Benutzer verworfen', () => {
		speichere('b1', '2026-10-20', [EINSATZ], berlinZeitpunkt('2026-10-20', 7));
		expect(lade(berlinZeitpunkt('2026-10-21', 7), nutzerKennung('b1'))).toBeNull();
		expect(speicher.getItem(SCHLUESSEL)).toBeNull();
	});
});
