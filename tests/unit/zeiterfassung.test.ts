import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	arbzgHinweise,
	csv,
	csvFeld,
	kmAusLuftlinie,
	luftlinieKm,
	ohne,
	stundenText,
	summiere,
	tagesUebersicht,
	tageZwischen,
	vereinige,
	type ZeitEintrag
} from '../../src/lib/zeiterfassung';
import { fahrKm, umwegFaktor } from '../../src/lib/server/routen';

const e = (art: ZeitEintrag['art'], beginn: string, ende: string | null, extra: Partial<ZeitEintrag> = {}): ZeitEintrag => ({
	id: Math.random().toString(36),
	benutzerId: 'b',
	auftragId: 'a',
	art,
	beginn: new Date(beginn).toISOString(),
	ende: ende ? new Date(ende).toISOString() : null,
	pauseMin: 0,
	km: null,
	kmBerechnet: null,
	kmQuelle: null,
	notiz: null,
	manuell: false,
	korrekturGrund: null,
	freigegeben: false,
	...extra
});
const JETZT = new Date('2026-10-20T18:00:00+02:00');

describe('Zeiterfassung – Rechnen', () => {
	it('vereinigt überlappende und angrenzende Abschnitte; „ohne“ schneidet heraus', () => {
		expect(vereinige([{ von: 5, bis: 10 }, { von: 0, bis: 3 }, { von: 3, bis: 6 }, { von: 20, bis: 20 }])).toEqual([{ von: 0, bis: 10 }]);
		expect(ohne([{ von: 0, bis: 10 }], [{ von: 2, bis: 4 }, { von: 8, bis: 12 }])).toEqual([{ von: 0, bis: 2 }, { von: 4, bis: 8 }]);
	});

	it('Arbeit mit Pausenabschnitt dazwischen (Stempeln: Start → Pause → Weiter → Fertig)', () => {
		const s = summiere(
			[
				e('arbeit', '2026-10-20T07:00:00+02:00', '2026-10-20T12:00:00+02:00'),
				e('pause', '2026-10-20T12:00:00+02:00', '2026-10-20T12:30:00+02:00'),
				e('arbeit', '2026-10-20T12:30:00+02:00', '2026-10-20T16:00:00+02:00')
			],
			JETZT
		);
		expect(s).toEqual({ arbeitMin: 510, pauseMin: 30, fahrtMin: 0, km: 0 });
		expect(stundenText(s.arbeitMin)).toBe('8:30 h');
	});

	it('nachgetragene Pause im Arbeitsabschnitt wird abgezogen und zählt als Pause', () => {
		const s = summiere([e('arbeit', '2026-10-20T08:00:00+02:00', '2026-10-20T16:30:00+02:00', { pauseMin: 30 })], JETZT);
		expect(s).toMatchObject({ arbeitMin: 480, pauseMin: 30 });
	});

	it('Überschneidungen zählen nie doppelt; Fahrt innerhalb der Arbeit zählt als Arbeit', () => {
		const s = summiere(
			[
				e('arbeit', '2026-10-20T08:00:00+02:00', '2026-10-20T12:00:00+02:00'),
				e('arbeit', '2026-10-20T11:00:00+02:00', '2026-10-20T13:00:00+02:00'),
				e('fahrt', '2026-10-20T07:30:00+02:00', '2026-10-20T08:30:00+02:00', { km: 12.4 }),
				e('pause', '2026-10-20T10:00:00+02:00', '2026-10-20T10:15:00+02:00')
			],
			JETZT
		);
		// Arbeit 8–13 = 5 h minus 15 Min. Pause; Fahrt nur 7:30–8:00
		expect(s).toEqual({ arbeitMin: 285, pauseMin: 15, fahrtMin: 30, km: 12.4 });
	});

	it('laufender Abschnitt zählt bis jetzt', () => {
		expect(summiere([e('arbeit', '2026-10-20T16:30:00+02:00', null)], JETZT).arbeitMin).toBe(90);
	});

	it('Abschnitt über Mitternacht wird auf die Tage aufgeteilt (auch die nachgetragene Pause anteilig)', () => {
		const liste = [e('arbeit', '2026-10-20T22:00:00+02:00', '2026-10-21T02:00:00+02:00', { pauseMin: 40 })];
		const tage = tagesUebersicht(liste, ['2026-10-20', '2026-10-21'], new Date('2026-10-22T00:00:00Z'));
		expect(tage[0]).toMatchObject({ tag: '2026-10-20', arbeitMin: 100, pauseMin: 20, beginn: '22:00', ende: '00:00' });
		expect(tage[1]).toMatchObject({ tag: '2026-10-21', arbeitMin: 100, pauseMin: 20, beginn: '00:00', ende: '02:00' });
	});

	it('Hinweise nach ArbZG: >6 h ohne 30 Min., >9 h ohne 45 Min., >10 h', () => {
		expect(arbzgHinweise({ arbeitMin: 360, pauseMin: 0 })).toEqual([]);
		expect(arbzgHinweise({ arbeitMin: 361, pauseMin: 15 })[0]).toMatch(/30 Minuten/);
		expect(arbzgHinweise({ arbeitMin: 361, pauseMin: 30 })).toEqual([]);
		expect(arbzgHinweise({ arbeitMin: 541, pauseMin: 30 })[0]).toMatch(/45 Minuten/);
		expect(arbzgHinweise({ arbeitMin: 601, pauseMin: 60 })).toEqual([expect.stringMatching(/10 Stunden/)]);
	});

	it('Tage im Zeitraum (höchstens 62)', () => {
		expect(tageZwischen('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
		expect(tageZwischen('2026-01-01', '2026-12-31')).toHaveLength(62);
	});
});

describe('Zeiterfassung – Kilometer', () => {
	const hamburg = { lat: 53.5511, lng: 9.9937 };
	const norderstedt = { lat: 53.7064, lng: 10.0102 };
	afterEach(() => vi.unstubAllGlobals());

	it('Luftlinie (Haversine) und × Umwegfaktor', () => {
		expect(luftlinieKm(hamburg, norderstedt)).toBeCloseTo(17.3, 0);
		expect(kmAusLuftlinie(hamburg, norderstedt)).toBeCloseTo(17.3 * 1.3, 0);
		expect(kmAusLuftlinie(hamburg, hamburg)).toBe(0);
	});

	it('Umwegfaktor aus der Umgebung (1–3), sonst 1,3', () => {
		expect(umwegFaktor({})).toBe(1.3);
		expect(umwegFaktor({ CRM_ROUTEN_FAKTOR: '1,4' })).toBe(1.4);
		expect(umwegFaktor({ CRM_ROUTEN_FAKTOR: '9' })).toBe(1.3);
	});

	it('ohne CRM_ROUTEN_URL: Luftlinie × Faktor, keine Netzanfrage', async () => {
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		const r = await fahrKm(hamburg, norderstedt, {});
		expect(r.quelle).toBe('luftlinie');
		expect(f).not.toHaveBeenCalled();
	});

	it('mit OSRM: Straßenstrecke; bei Fehler oder Unsinn Rückfall auf Luftlinie', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 21456 }] }), { status: 200 })));
		expect(await fahrKm(hamburg, norderstedt, { CRM_ROUTEN_URL: 'https://osrm.test/' })).toEqual({ km: 21.5, quelle: 'route' });
		const aufruf = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(aufruf).toBe('https://osrm.test/route/v1/driving/9.9937,53.5511;10.0102,53.7064?overview=false');

		vi.stubGlobal('fetch', vi.fn(async () => new Response('kaputt', { status: 502 })));
		expect((await fahrKm(hamburg, norderstedt, { CRM_ROUTEN_URL: 'https://osrm.test' })).quelle).toBe('luftlinie');
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('netz'); }));
		expect((await fahrKm(hamburg, norderstedt, { CRM_ROUTEN_URL: 'https://osrm.test' })).quelle).toBe('luftlinie');
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 })));
		expect((await fahrKm(hamburg, norderstedt, { CRM_ROUTEN_URL: 'https://osrm.test' })).quelle).toBe('luftlinie');
	});
});

describe('Zeiterfassung – CSV', () => {
	it('Semikolon, Komma als Dezimalzeichen, Anführungszeichen, Formeln entschärft, BOM', () => {
		expect(csvFeld(7.5)).toBe('7,5');
		expect(csvFeld('a;b')).toBe('"a;b"');
		expect(csvFeld('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
		expect(csv([['Tag', 'Stunden'], ['2026-10-20', 8.25]])).toBe('﻿Tag;Stunden\r\n2026-10-20;8,25\r\n');
	});
});

describe('Zeiterfassung – Monatssicht (msg 2797)', () => {
	it('Monatstage, Soll (Mo–Fr ohne Abwesenheit × Stunden), Wochensummen', async () => {
		const { monatsTage, sollMinuten, wochenSummen, istMonat } = await import('../../src/lib/zeiterfassung');
		const { wochentag, kalenderwoche } = await import('../../src/lib/zeit');
		const okt = monatsTage('2026-10');
		expect(okt).toHaveLength(31);
		expect(monatsTage('2028-02')).toHaveLength(29);
		expect(istMonat('2026-13')).toBe(false);
		expect(sollMinuten(okt, 8, new Set(), wochentag)).toBe(22 * 8 * 60);
		expect(sollMinuten(okt, 8, new Set(['2026-10-05', '2026-10-10']), wochentag)).toBe(21 * 8 * 60); // Sa zählt nicht
		expect(sollMinuten(okt, null, new Set(), wochentag)).toBeNull();
		const zeilen = ['2026-10-02', '2026-10-05', '2026-10-06'].map((tag) => ({ tag, arbeitMin: 60, pauseMin: 10, fahrtMin: 5, km: 1.5, beginn: null, ende: null, hinweise: [], eintraege: 1 }));
		expect(wochenSummen(zeilen, kalenderwoche)).toEqual([
			{ kw: 40, arbeitMin: 60, pauseMin: 10, fahrtMin: 5, km: 1.5 },
			{ kw: 41, arbeitMin: 120, pauseMin: 20, fahrtMin: 10, km: 3 }
		]);
	});
});
