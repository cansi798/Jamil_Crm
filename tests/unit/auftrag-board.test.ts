import { describe, expect, it } from 'vitest';
import {
	aktualisiereKarte,
	initialen,
	kurzAdresse,
	moeglicheZiele,
	verschiebeKarte,
	zielErlaubt,
	type BoardSpalte
} from '../../src/lib/auftrag-board';
import { STATUS, type AuftragStatus } from '../../src/lib/auftrag-status';

type K = { id: string; status: AuftragStatus; titel: string; extra?: string };

const board = (): BoardSpalte<K>[] =>
	STATUS.map((status) => ({ status, anzahl: 0, karten: [] as K[] })).map((s) =>
		s.status === 'anfrage'
			? { ...s, anzahl: 3, karten: [{ id: 'a', status: 'anfrage', titel: 'A' }, { id: 'b', status: 'anfrage', titel: 'B' }] }
			: s.status === 'angebot'
				? { ...s, anzahl: 1, karten: [{ id: 'c', status: 'angebot', titel: 'C', extra: 'x' }] }
				: s
	);

describe('Auftrags-Board (Browser-Zustand)', () => {
	it('erlaubt nur Nachbarspalten', () => {
		expect(zielErlaubt('anfrage', 'angebot')).toBe(true);
		expect(zielErlaubt('angebot', 'anfrage')).toBe(true);
		expect(zielErlaubt('anfrage', 'beauftragt')).toBe(false);
		expect(zielErlaubt('anfrage', 'anfrage')).toBe(false);
		expect(zielErlaubt('abgerechnet', 'anfrage')).toBe(false);
	});

	it('liefert Menüziele zurück/weiter, an den Enden nur eines', () => {
		expect(moeglicheZiele('anfrage')).toEqual([{ richtung: 'weiter', status: 'angebot' }]);
		expect(moeglicheZiele('beauftragt')).toEqual([
			{ richtung: 'zurueck', status: 'angebot' },
			{ richtung: 'weiter', status: 'in_arbeit' }
		]);
		expect(moeglicheZiele('abgerechnet')).toEqual([{ richtung: 'zurueck', status: 'abgenommen' }]);
	});

	it('verschiebt eine Karte oben in die Zielspalte und passt die Anzahl an', () => {
		const vorher = board();
		const nachher = verschiebeKarte(vorher, 'b', 'angebot');
		expect(nachher.find((s) => s.status === 'anfrage')).toMatchObject({ anzahl: 2, karten: [{ id: 'a' }] });
		const angebot = nachher.find((s) => s.status === 'angebot')!;
		expect(angebot.anzahl).toBe(2);
		expect(angebot.karten.map((k) => k.id)).toEqual(['b', 'c']);
		expect(angebot.karten[0].status).toBe('angebot');
		// unveränderlich: das alte Board bleibt, wie es war
		expect(vorher.find((s) => s.status === 'anfrage')!.karten).toHaveLength(2);
	});

	it('lässt das Board bei verbotenem Sprung oder unbekannter Karte unverändert', () => {
		const vorher = board();
		expect(verschiebeKarte(vorher, 'a', 'in_arbeit')).toBe(vorher);
		expect(verschiebeKarte(vorher, 'gibt-es-nicht', 'angebot')).toBe(vorher);
	});

	it('nimmt eine Verschiebung zurück (Rollback = Rückweg in die alte Spalte)', () => {
		const vorher = board();
		const hin = verschiebeKarte(vorher, 'a', 'angebot');
		const zurueck = verschiebeKarte(hin, 'a', 'anfrage');
		expect(zurueck.find((s) => s.status === 'anfrage')!.karten.map((k) => k.id).sort()).toEqual(['a', 'b']);
		expect(zurueck.find((s) => s.status === 'anfrage')!.anzahl).toBe(3);
		expect(zurueck.find((s) => s.status === 'angebot')!.anzahl).toBe(1);
	});

	it('aktualisiert eine Karte mit Serverwerten und behält fehlende Felder', () => {
		const neu = aktualisiereKarte(board(), { id: 'c', titel: 'C neu' });
		expect(neu.find((s) => s.status === 'angebot')!.karten[0]).toEqual({ id: 'c', status: 'angebot', titel: 'C neu', extra: 'x' });
	});

	it('kürzt Adressen (ohne PLZ) und bildet Initialen', () => {
		expect(kurzAdresse('Hauptstr. 1, 12345 Berlin')).toBe('Hauptstr. 1, Berlin');
		expect(kurzAdresse('12345 Berlin')).toBe('Berlin');
		expect(kurzAdresse(null)).toBeNull();
		expect(initialen('Max Muster')).toBe('MM');
		expect(initialen('jamil')).toBe('J');
		expect(initialen('Anna Maria Beispiel')).toBe('AB');
		expect(initialen('  ')).toBe('?');
	});
});
