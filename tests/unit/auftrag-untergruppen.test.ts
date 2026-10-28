import { describe, expect, it } from 'vitest';
import { UNTERGRUPPEN, untergruppe } from '../../src/lib/auftrag-board';

/** Untergruppen in „Anfrage“ und „Angebot“ (Jamil msg 3601) – nur Anzeige, abgeleitet aus Terminen und Angeboten. */
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
	it('andere Status haben keine Untergruppe; Reihenfolge der Gruppen fest', () => {
		for (const s of ['beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet'] as const) expect(untergruppe({ status: s, hatTermin: true })).toBeNull();
		expect(UNTERGRUPPEN.anfrage!.map((g) => g.titel)).toEqual(['Neu', 'Termin vereinbart']);
		expect(UNTERGRUPPEN.angebot!.map((g) => g.titel)).toEqual(['Noch kein Angebot', 'Angebot erhalten']);
	});
});
