import { describe, expect, it } from 'vitest';
import { balkenDerWoche, monatAusName, monatsWochen, termineAm, termineAus, terminFarbe, type KalEinsatz } from '../../src/lib/kalender';
import { FARB_PALETTE } from '../../src/lib/farben';
import { STATUS_FARBEN } from '../../src/lib/route';

const einsatz = (id: string, tag: string, o: Partial<KalEinsatz> = {}): KalEinsatz => ({
	id,
	auftragId: 'a1',
	auftragNummer: 'A-2026-0001',
	auftragTitel: 'Bad',
	kundeName: 'Müller',
	ort: null,
	benutzerId: 'u1',
	benutzerName: 'Ali',
	beginn: `${tag}T06:30:00Z`,
	ende: `${tag}T14:00:00Z`,
	art: 'montage',
	auftragStatus: 'beauftragt',
	warnungen: [],
	gruppe: null,
	kolonne: null,
	...o
});

describe('Kalender (msg 2676)', () => {
	it('Monat: Wochen Mo–So über den Monat (November 2026: 26.10.–6.12., 6 Wochen)', () => {
		const w = monatsWochen('2026-11');
		expect(w).toHaveLength(6);
		expect(w[0][0]).toBe('2026-10-26');
		expect(w[0][6]).toBe('2026-11-01');
		expect(w[5][0]).toBe('2026-11-30');
		expect(monatsWochen('2027-02')).toHaveLength(4); // 1.2.2027 ist Montag
	});

	it('Termine: Gruppe = ein Termin über alle Tage und Personen; Einzel-Einsatz = ein Termin; Warnung übernommen', () => {
		const g = { id: 'g1', vonTag: '2026-11-16', bisTag: '2026-11-18' };
		const ko = { id: 'k1', name: 'Kolonne A' };
		const t = termineAus([
			einsatz('e1', '2026-11-16', { gruppe: g, kolonne: ko }),
			einsatz('e2', '2026-11-16', { gruppe: g, kolonne: ko, benutzerId: 'u2', benutzerName: 'Bea' }),
			einsatz('e3', '2026-11-17', { gruppe: g, kolonne: ko, warnungen: [{}] }),
			einsatz('e4', '2026-11-20', { auftragId: 'a2', auftragTitel: 'Küche' })
		]);
		expect(t).toHaveLength(2);
		expect(t[0]).toMatchObject({ id: 'g1', vonTag: '2026-11-16', bisTag: '2026-11-18', warnung: true, kolonne: ko, zeit: '07:30–15:00' });
		expect(t[0].personen.map((p) => p.name)).toEqual(['Ali', 'Bea']);
		expect(t[0].einsaetze).toHaveLength(3);
		expect(t[1]).toMatchObject({ id: 'e4', vonTag: '2026-11-20', bisTag: '2026-11-20', titel: 'Küche' });
		expect(termineAm('2026-11-17', t).map((x) => x.id)).toEqual(['g1']);
	});

	it('Balken: Spuren ohne Überlappung, Länge in Tagen, „geht weiter“ über Wochengrenzen', () => {
		const woche = monatsWochen('2026-11')[3]; // 16.–22.11.
		const b = balkenDerWoche(woche, [
			{ id: 'lang', vonTag: '2026-11-13', bisTag: '2026-11-17' },
			{ id: 'mitte', vonTag: '2026-11-17', bisTag: '2026-11-18' },
			{ id: 'frei', vonTag: '2026-11-19', bisTag: '2026-11-19' },
			{ id: 'raus', vonTag: '2026-11-22', bisTag: '2026-11-25' },
			{ id: 'vorher', vonTag: '2026-11-02', bisTag: '2026-11-03' }
		]);
		const nach = Object.fromEntries(b.map((x) => [(x.termin as { id: string }).id, x]));
		expect(Object.keys(nach).sort()).toEqual(['frei', 'lang', 'mitte', 'raus']);
		expect(nach.lang).toMatchObject({ start: 0, laenge: 2, spur: 0, weiterLinks: true, weiterRechts: false });
		expect(nach.mitte).toMatchObject({ start: 1, laenge: 2, spur: 1 });
		expect(nach.frei).toMatchObject({ start: 3, laenge: 1, spur: 0 });
		expect(nach.raus).toMatchObject({ start: 6, laenge: 1, spur: 0, weiterRechts: true });
	});

	it('Farben: Mitarbeiter/Kolonne fest nach Reihenfolge, Status nach Auftragsstatus', () => {
		const r = { personen: ['u1', 'u2'], kolonnen: ['k1'] };
		expect(terminFarbe({ kolonne: null, personen: [{ id: 'u2', name: 'B' }], status: 'anfrage' }, 'person', r)).toBe(FARB_PALETTE[1]);
		expect(terminFarbe({ kolonne: { id: 'k1', name: 'K' }, personen: [], status: 'anfrage' }, 'person', r)).toBe(FARB_PALETTE[FARB_PALETTE.length - 1]);
		expect(terminFarbe({ kolonne: null, personen: [], status: 'beauftragt' }, 'status', r)).toBe(STATUS_FARBEN.beauftragt);
	});

	it('Monat aus Name: nächstes Vorkommen', () => {
		expect(monatAusName('November', '2026-10-20')).toBe('2026-11');
		expect(monatAusName('Oktober', '2026-10-20')).toBe('2026-10');
		expect(monatAusName('Januar', '2026-10-20')).toBe('2027-01');
		expect(monatAusName('März', '2026-10-20')).toBe('2027-03');
		expect(monatAusName('Quatsch', '2026-10-20')).toBeNull();
	});
});
