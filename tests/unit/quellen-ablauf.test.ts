import { describe, expect, it } from 'vitest';
import {
	ABLAUF_SCHRITTE,
	moeglicheZiele,
	naechsterGeltenderStatus,
	schrittUebersprungen,
	startStatus,
	statusUebersprungen,
	untergruppe,
	verschiebeKarte,
	vorigerGeltenderStatus,
	zielErlaubt
} from '../../src/lib/auftrag-board';

/** Ablauf je Auftragsquelle (Jamil msg 3703): gilt / überspringen je Schritt. */
describe('Ablauf je Auftragsquelle', () => {
	it('Schritte = die offenen Untergruppen in fester Reihenfolge', () => {
		expect(ABLAUF_SCHRITTE.map((s) => [s.status, s.id])).toEqual([
			['anfrage', 'neu'],
			['angebot', 'ohne_angebot'],
			['beauftragt', 'planung'],
			['in_arbeit', 'arbeiten'],
			['in_arbeit', 'qualitaet'],
			['in_arbeit', 'abnahme']
		]);
	});

	it('ohne Einstellung (Standard) bleibt alles wie bisher', () => {
		expect(naechsterGeltenderStatus('anfrage')).toBe('angebot');
		expect(vorigerGeltenderStatus('angebot')).toBe('anfrage');
		expect(startStatus()).toBe('anfrage');
		expect(zielErlaubt('anfrage', 'angebot')).toBe(true);
		expect(zielErlaubt('anfrage', 'beauftragt')).toBe(false);
		expect(moeglicheZiele('angebot')).toEqual([
			{ richtung: 'zurueck', status: 'anfrage' },
			{ richtung: 'weiter', status: 'beauftragt' }
		]);
		expect(untergruppe({ status: 'anfrage', quelleUebersprungen: [] })).toBe('neu');
	});

	it('ein Status ist übersprungen, wenn alle seine Schritte übersprungen sind', () => {
		expect(statusUebersprungen('angebot', ['ohne_angebot'])).toBe(true);
		expect(statusUebersprungen('in_arbeit', ['arbeiten', 'qualitaet'])).toBe(false);
		expect(statusUebersprungen('in_arbeit', ['arbeiten', 'qualitaet', 'abnahme'])).toBe(true);
		expect(statusUebersprungen('abgenommen', ['neu', 'ohne_angebot', 'planung', 'arbeiten', 'qualitaet', 'abnahme'])).toBe(false);
	});

	it('Weiter/Zurück und Ziehen lassen übersprungene Status aus; Start im ersten geltenden', () => {
		const ueb = ['neu', 'ohne_angebot'];
		expect(startStatus(ueb)).toBe('beauftragt');
		expect(naechsterGeltenderStatus('anfrage', ['ohne_angebot'])).toBe('beauftragt');
		expect(vorigerGeltenderStatus('beauftragt', ['ohne_angebot'])).toBe('anfrage');
		expect(zielErlaubt('anfrage', 'beauftragt', ['ohne_angebot'])).toBe(true);
		expect(zielErlaubt('anfrage', 'angebot', ['ohne_angebot'])).toBe(false);
		expect(moeglicheZiele('beauftragt', ['ohne_angebot'])[0]).toEqual({ richtung: 'zurueck', status: 'anfrage' });
		const spalten = [
			{ status: 'anfrage' as const, anzahl: 1, karten: [{ id: 'a', status: 'anfrage' as const, quelleUebersprungen: ['ohne_angebot'] }] },
			{ status: 'angebot' as const, anzahl: 0, karten: [] },
			{ status: 'beauftragt' as const, anzahl: 0, karten: [] }
		];
		expect(verschiebeKarte(spalten, 'a', 'angebot')).toBe(spalten);
		expect(verschiebeKarte(spalten, 'a', 'beauftragt')[2].karten.map((k) => k.id)).toEqual(['a']);
	});

	it('Untergruppen: übersprungene Schritte erscheinen nicht', () => {
		// In Arbeit: nächster geltender Schritt, sonst der vorige
		expect(untergruppe({ status: 'in_arbeit', arbeitsstand: null, quelleUebersprungen: ['arbeiten'] })).toBe('qualitaet');
		expect(untergruppe({ status: 'in_arbeit', arbeitsstand: 'abnahme', quelleUebersprungen: ['abnahme'] })).toBe('qualitaet');
		// erreichter Stand bleibt (ein Termin ist ja da)
		expect(untergruppe({ status: 'anfrage', hatTermin: true, quelleUebersprungen: ['neu'] })).toBe('termin');
		// kein geltender Schritt im Status → „Schritt übersprungen“
		const a = { status: 'angebot' as const, angebotInfo: null, quelleUebersprungen: ['ohne_angebot'] };
		expect(untergruppe(a)).toBeNull();
		expect(schrittUebersprungen(a)).toBe(true);
		expect(schrittUebersprungen({ status: 'abgenommen', quelleUebersprungen: ['ohne_angebot'] })).toBe(false);
	});
});
