import { describe, expect, it } from 'vitest';
import { istArbeitsstand, UNTERGRUPPEN, UNTERGRUPPE_TITEL, untergruppe, untergruppeErledigt } from '../../src/lib/auftrag-board';

/** Untergruppen in „Anfrage“ bis „In Arbeit“ (Jamil msgs 3601, 3655, 3658–3660) – nur Anzeige, abgeleitet aus Terminen und Angeboten. */
describe('untergruppe', () => {
	it('Anfrage: ohne Termin „neu“, mit Termin (auch vergangenem) „termin“', () => {
		expect(untergruppe({ status: 'anfrage', hatTermin: false })).toBe('neu');
		expect(untergruppe({ status: 'anfrage', hatTermin: true })).toBe('termin');
		expect(untergruppe({ status: 'anfrage' })).toBe('neu');
	});
	it('Angebot: verschicktes (auch angenommenes/abgelehntes) Angebot zählt, Entwurf nicht', () => {
		expect(untergruppe({ status: 'angebot', angebotInfo: null })).toBe('ohne_angebot');
		expect(untergruppe({ status: 'angebot', angebotInfo: { status: 'versendet' } })).toBe('mit_angebot');
		expect(untergruppe({ status: 'angebot', angebotInfo: { status: 'abgelehnt' } })).toBe('mit_angebot');
	});
	it('Beauftragt: nur ein Umsetzungstermin zählt, irgendein Termin nicht', () => {
		expect(untergruppe({ status: 'beauftragt', hatTermin: true, hatUmsetzungstermin: false })).toBe('planung');
		expect(untergruppe({ status: 'beauftragt', hatUmsetzungstermin: true })).toBe('umsetzung');
		expect(untergruppe({ status: 'beauftragt' })).toBe('planung');
	});
	it('In Arbeit: Arbeitsstand aus dem Feld, leer oder unbekannt = „Arbeiten durchführen“', () => {
		expect(untergruppe({ status: 'in_arbeit' })).toBe('arbeiten');
		expect(untergruppe({ status: 'in_arbeit', arbeitsstand: null })).toBe('arbeiten');
		expect(untergruppe({ status: 'in_arbeit', arbeitsstand: 'qualitaet' })).toBe('qualitaet');
		expect(untergruppe({ status: 'in_arbeit', arbeitsstand: 'abnahme' })).toBe('abnahme');
		expect(untergruppe({ status: 'in_arbeit', arbeitsstand: 'quatsch' })).toBe('arbeiten');
		expect(istArbeitsstand('arbeiten')).toBe(false);
	});
	it('spätere Status haben keine Untergruppe; Reihenfolge, Titel und Farbe fest', () => {
		for (const s of ['abgenommen', 'abgerechnet'] as const)
			expect(untergruppe({ status: s, hatTermin: true, hatUmsetzungstermin: true, arbeitsstand: 'abnahme' })).toBeNull();
		expect(UNTERGRUPPEN.anfrage!.map((g) => g.titel)).toEqual(['Termin vereinbaren', 'Termin vereinbart']);
		expect(UNTERGRUPPEN.angebot!.map((g) => g.titel)).toEqual(['Angebot erstellen', 'Angebot erhalten']);
		expect(UNTERGRUPPEN.beauftragt!.map((g) => g.titel)).toEqual(['Planung durchführen', 'Termin zur Umsetzung bestätigt']);
		expect(UNTERGRUPPEN.in_arbeit!.map((g) => g.titel)).toEqual([
			'Arbeiten durchführen',
			'Qualitätsprüfung durchführen',
			'Endabnahme mit Kunden durchführen'
		]);
		expect(UNTERGRUPPE_TITEL.umsetzung).toBe('Termin zur Umsetzung bestätigt');
		// offene Gruppen (nächster Schritt) grau, erreichter Stand grün
		for (const s of ['anfrage', 'angebot', 'beauftragt'] as const)
			expect(UNTERGRUPPEN[s]!.map((g) => untergruppeErledigt(g.id))).toEqual([false, true]);
		expect(UNTERGRUPPEN.in_arbeit!.some((g) => untergruppeErledigt(g.id))).toBe(false);
	});
});
