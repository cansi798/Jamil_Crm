import { describe, expect, it } from 'vitest';
import {
	fensterAmTag,
	freieZeiten,
	grundBelegt,
	ohne,
	pruefeKontakt,
	rasterFuer,
	telefonSchluessel,
	waehleMitarbeiter,
	type DienstRegeln,
	type Verfuegbarkeit
} from '../../src/lib/buchung';
import { pruefeAntworten } from '../../src/lib/server/buchung-oeffentlich';
import { pruefeFragen, pruefeDomains, normaleDomain, pruefeDienstEingabe } from '../../src/lib/server/buchung';
import { formStempel, pruefeStempel, verwaltungsHash, neuesVerwaltungsToken } from '../../src/lib/server/buchung-schutz';
import { icsDatei, falte } from '../../src/lib/ics';
import { mitSicherheitsKopfzeilen } from '../../src/lib/server/sicherheit';
import { akzentLesbar, schriftAuf } from '../../src/lib/farben';
import { berlinZeitpunkt } from '../../src/lib/zeit';
import { deute } from '../../src/lib/server/ki/fake';

// Mittwoch, 21.10.2026, 08:00 Berlin (Sommerzeit bis 25.10.)
const JETZT = berlinZeitpunkt('2026-10-21', 8, 0);
const t = (tag: string, h: number, m = 0) => berlinZeitpunkt(tag, h, m).getTime();
const iso = (tag: string, h: number, m = 0) => berlinZeitpunkt(tag, h, m).toISOString();

const REGELN: DienstRegeln = { dauerMin: 60, pufferVorMin: 0, pufferNachMin: 0, vorlaufMin: 0, horizontTage: 30, maxProTag: null };

function ma(id: string, extra: Partial<Verfuegbarkeit> = {}): Verfuegbarkeit {
	return {
		id,
		// Mo–Fr 8–12 Uhr
		zeiten: [0, 1, 2, 3, 4].map((wochentag) => ({ wochentag, von: '08:00', bis: '12:00' })),
		ausnahmen: [],
		belegt: [],
		abwesend: [],
		buchungenJeTag: {},
		...extra
	};
}
const zeitenAm = (tage: ReturnType<typeof freieZeiten>, tag: string) => tage.find((x) => x.tag === tag)?.zeiten.map((z) => z.beginn) ?? [];

describe('Freie Zeiten der Online-Buchung', () => {
	it('Raster im Arbeitsfenster: 60 Minuten → alle 30 Minuten, letzter Beginn passt noch ganz hinein', () => {
		expect(rasterFuer(60)).toBe(30);
		expect(rasterFuer(30)).toBe(15);
		const tage = freieZeiten(REGELN, [ma('a')], { vonTag: '2026-10-22', bisTag: '2026-10-22', jetzt: JETZT });
		expect(zeitenAm(tage, '2026-10-22')).toEqual([iso('2026-10-22', 8), iso('2026-10-22', 8, 30), iso('2026-10-22', 9), iso('2026-10-22', 9, 30), iso('2026-10-22', 10), iso('2026-10-22', 10, 30), iso('2026-10-22', 11)]);
	});

	it('Wochenende ohne Arbeitszeit ist nicht buchbar', () => {
		const tage = freieZeiten(REGELN, [ma('a')], { vonTag: '2026-10-24', bisTag: '2026-10-25', jetzt: JETZT });
		expect(tage).toEqual([]);
	});

	it('Mindestvorlauf: heute erst ab jetzt + Vorlauf; 1 Tag Vorlauf → heute gar nichts', () => {
		const heute = freieZeiten({ ...REGELN, vorlaufMin: 120 }, [ma('a')], { vonTag: '2026-10-21', bisTag: '2026-10-21', jetzt: JETZT });
		expect(zeitenAm(heute, '2026-10-21')[0]).toBe(iso('2026-10-21', 10));
		const tag = freieZeiten({ ...REGELN, vorlaufMin: 1440 }, [ma('a')], { vonTag: '2026-10-21', bisTag: '2026-10-22', jetzt: JETZT });
		expect(zeitenAm(tag, '2026-10-21')).toEqual([]);
		expect(zeitenAm(tag, '2026-10-22')[0]).toBe(iso('2026-10-22', 8));
	});

	it('Buchungshorizont: nach heute + Horizont nichts mehr', () => {
		const tage = freieZeiten({ ...REGELN, horizontTage: 2 }, [ma('a')], { vonTag: '2026-10-21', bisTag: '2026-10-30', jetzt: JETZT });
		expect(tage.map((x) => x.tag)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
		expect(grundBelegt({ ...REGELN, horizontTage: 2 }, ma('a'), t('2026-10-26', 9), JETZT.getTime())).toBe('horizont');
	});

	it('Einsatz in der Plantafel belegt – mit Puffer davor und danach', () => {
		const einsatz = { beginn: t('2026-10-22', 10), ende: t('2026-10-22', 11) };
		const ohnePuffer = freieZeiten(REGELN, [ma('a', { belegt: [einsatz] })], { vonTag: '2026-10-22', bisTag: '2026-10-22', jetzt: JETZT });
		// 9:00–10:00 grenzt an (frei), 9:30 und 10:00/10:30 überschneiden, 11:00 frei
		expect(zeitenAm(ohnePuffer, '2026-10-22')).toEqual([iso('2026-10-22', 8), iso('2026-10-22', 8, 30), iso('2026-10-22', 9), iso('2026-10-22', 11)]);
		const mitPuffer = freieZeiten({ ...REGELN, pufferVorMin: 30, pufferNachMin: 15 }, [ma('a', { belegt: [einsatz] })], {
			vonTag: '2026-10-22',
			bisTag: '2026-10-22',
			jetzt: JETZT
		});
		// Termin 9:00–10:00 + 15 Min. danach stößt an den Einsatz; 11:00 − 30 Min. davor ebenso
		expect(zeitenAm(mitPuffer, '2026-10-22')).toEqual([iso('2026-10-22', 8), iso('2026-10-22', 8, 30)]);
		expect(grundBelegt({ ...REGELN, pufferVorMin: 30 }, ma('a', { belegt: [einsatz] }), t('2026-10-22', 11), JETZT.getTime())).toBe('belegt');
	});

	it('Puffer einer vorhandenen Buchung gilt auch für den neuen Termin (nicht doppelt gerechnet)', () => {
		const buchung = { beginn: t('2026-10-22', 9), ende: t('2026-10-22', 10), vor: 0, nach: 30 * 60_000 };
		const v = ma('a', { belegt: [buchung] });
		// neuer Termin ohne eigene Puffer: 10:00 fällt in den Puffer danach, 10:30 ist frei
		expect(grundBelegt(REGELN, v, t('2026-10-22', 10), JETZT.getTime())).toBe('belegt');
		expect(grundBelegt(REGELN, v, t('2026-10-22', 10, 30), JETZT.getTime())).toBeNull();
		// mit eigenem Puffer davor 30 Min.: 10:30 reicht (Puffer überlappen sich, sie addieren sich nicht)
		expect(grundBelegt({ ...REGELN, pufferVorMin: 30 }, v, t('2026-10-22', 10, 30), JETZT.getTime())).toBeNull();
	});

	it('Abwesenheit (Urlaub) sperrt den ganzen Tag; Ausnahme „frei“ ganz oder teilweise; „zusätzlich“ erweitert', () => {
		const urlaub = freieZeiten(REGELN, [ma('a', { abwesend: [{ von: '2026-10-22', bis: '2026-10-23' }] })], { vonTag: '2026-10-22', bisTag: '2026-10-26', jetzt: JETZT });
		expect(urlaub.map((x) => x.tag)).toEqual(['2026-10-26']);
		const v = ma('a', {
			ausnahmen: [
				{ tag: '2026-10-22', art: 'frei', von: '09:00', bis: '11:00' },
				{ tag: '2026-10-23', art: 'frei', von: null, bis: null },
				{ tag: '2026-10-24', art: 'zusaetzlich', von: '10:00', bis: '11:00' }
			]
		});
		expect(fensterAmTag(v, '2026-10-22')).toEqual([
			{ beginn: t('2026-10-22', 8), ende: t('2026-10-22', 9) },
			{ beginn: t('2026-10-22', 11), ende: t('2026-10-22', 12) }
		]);
		expect(fensterAmTag(v, '2026-10-23')).toEqual([]);
		expect(fensterAmTag(v, '2026-10-24')).toEqual([{ beginn: t('2026-10-24', 10), ende: t('2026-10-24', 11) }]);
	});

	it('Tagesgrenze je Mitarbeiter und Dienst', () => {
		const v = ma('a', { buchungenJeTag: { '2026-10-22': 2 } });
		expect(freieZeiten({ ...REGELN, maxProTag: 2 }, [v], { vonTag: '2026-10-22', bisTag: '2026-10-22', jetzt: JETZT })).toEqual([]);
		expect(freieZeiten({ ...REGELN, maxProTag: 3 }, [v], { vonTag: '2026-10-22', bisTag: '2026-10-22', jetzt: JETZT })).toHaveLength(1);
	});

	it('Mehrere Mitarbeiter: Zeiten zusammengeführt, je Zeit die freien Mitarbeiter', () => {
		const a = ma('a', { belegt: [{ beginn: t('2026-10-22', 8), ende: t('2026-10-22', 12) }] });
		const b = ma('b');
		const tage = freieZeiten(REGELN, [a, b], { vonTag: '2026-10-22', bisTag: '2026-10-22', jetzt: JETZT });
		expect(tage[0].zeiten.every((z) => z.mitarbeiter.length === 1 && z.mitarbeiter[0] === 'b')).toBe(true);
	});

	it('Zeitumstellung (25.10.): Zeiten bleiben Berliner Wanduhr', () => {
		const tage = freieZeiten(REGELN, [ma('a', { zeiten: [{ wochentag: 0, von: '08:00', bis: '09:00' }] })], { vonTag: '2026-10-26', bisTag: '2026-10-26', jetzt: JETZT });
		expect(tage[0].zeiten[0].beginn).toBe('2026-10-26T07:00:00.000Z');
	});

	it('Intervalle abziehen', () => {
		expect(ohne([{ beginn: 0, ende: 10 }], [{ beginn: 3, ende: 5 }])).toEqual([
			{ beginn: 0, ende: 3 },
			{ beginn: 5, ende: 10 }
		]);
	});

	it('Abwechselnd verteilen: wenigste Buchungen, dann am längsten keine', () => {
		expect(waehleMitarbeiter(['a', 'b'], { a: { anzahl: 2, zuletzt: 1 }, b: { anzahl: 1, zuletzt: 5 } })).toBe('b');
		expect(waehleMitarbeiter(['a', 'b'], { a: { anzahl: 1, zuletzt: 9 }, b: { anzahl: 1, zuletzt: 5 } })).toBe('b');
		expect(waehleMitarbeiter(['a', 'b'], { a: { anzahl: 1, zuletzt: 9 } })).toBe('b');
		expect(waehleMitarbeiter([], {})).toBeNull();
	});
});

describe('Fragen der Online-Buchung (gemeinsamer Formular-Baukasten)', () => {
	const fragen = pruefeFragen({
		seiten: [
			{
				id: 's1',
				titel: 'Fragen',
				abschnitte: [
					{
						id: 'a1',
						felder: [
							{ id: 'art', typ: 'auswahl', label: 'Worum geht es?', optionen: ['Bad', 'Küche'], pflicht: true },
							{ id: 'flaeche', typ: 'zahl', label: 'Fläche in m²', min: 1, max: 500 },
							{ id: 'dusche', typ: 'janein', label: 'Bodengleiche Dusche?', bedingung: { feld: 'art', op: 'gleich', wert: 'Bad', wirkung: 'zeigen' } },
							{ id: 'foto', typ: 'foto', label: 'Foto vom Bad', bedingung: { feld: 'dusche', op: 'gleich', wert: 'ja', wirkung: 'pflicht' } }
						]
					}
				]
			}
		]
	});

	it('nur Feldtypen für Kunden, höchstens ein Schritt, leer = keine Fragen', () => {
		expect(pruefeFragen('')).toEqual({ seiten: [] });
		expect(pruefeFragen({ seiten: [{ id: 's1', titel: 'x', abschnitte: [{ id: 'a1', felder: [] }] }] })).toEqual({ seiten: [] });
		expect(() => pruefeFragen({ seiten: [{ id: 's1', titel: 'x', abschnitte: [{ id: 'a1', felder: [{ id: 'u', typ: 'unterschrift', label: 'U' }] }] }] })).toThrow(/Feldtyp/);
		const zwei = { seiten: [1, 2].map((n) => ({ id: `s${n}`, titel: 'x', abschnitte: [{ id: `a${n}`, felder: [{ id: `f${n}`, typ: 'text', label: 'T' }] }] })) };
		expect(() => pruefeFragen(zwei)).toThrow(/ein Schritt/);
	});

	it('Bedingung „nur zeigen, wenn“: Antwort eines verborgenen Felds fällt weg', () => {
		expect(pruefeAntworten(fragen, { art: 'Küche', dusche: true }, [])).toEqual({ art: 'Küche' });
		expect(pruefeAntworten(fragen, { art: 'Bad', dusche: false, flaeche: '7,5' }, [])).toEqual({ art: 'Bad', dusche: false, flaeche: 7.5 });
	});

	it('Pflicht und „Pflicht, wenn“: fehlt → 400 mit Liste; Foto erfüllt die Pflicht', () => {
		expect(() => pruefeAntworten(fragen, {}, [])).toThrow(/Worum geht es/);
		expect(() => pruefeAntworten(fragen, { art: 'Bad', dusche: true }, [])).toThrow(/Foto vom Bad/);
		const id = '0b7a3c9e-0000-4000-8000-000000000001';
		expect(pruefeAntworten(fragen, { art: 'Bad', dusche: true }, [{ tempId: id, feldId: 'foto', bytes: new Uint8Array(1) }])).toEqual({ art: 'Bad', dusche: true, foto: [id] });
		expect(() => pruefeAntworten(fragen, { art: 'Bad', flaeche: 9999 }, [])).toThrow(/höchstens 500/);
	});

	it('Fotos ohne passende Frage werden abgelehnt; unbekannte Antworten fallen weg', () => {
		expect(() => pruefeAntworten(fragen, { art: 'Bad' }, [{ tempId: 'x', feldId: 'gibtsnicht', bytes: new Uint8Array(1) }])).toThrow(/keiner Frage/);
		expect(pruefeAntworten(fragen, { art: 'Bad', boese: '<script>' }, [])).toEqual({ art: 'Bad' });
	});
});

describe('Kontakt, Dienst, Domains', () => {
	it('Standardfelder: Pflicht, E-Mail, Telefon, Adresse je Einstellung', () => {
		const gut = { vorname: ' Anna ', nachname: 'Schulz', email: 'Anna@Beispiel.DE', telefon: '+49 40 123456', strasse: 'Weg 1', plz: '22846', ort: 'Norderstedt' };
		expect(pruefeKontakt(gut, 'pflicht').werte).toMatchObject({ vorname: 'Anna', email: 'anna@beispiel.de' });
		expect(pruefeKontakt({ ...gut, strasse: '' }, 'pflicht').fehler).toHaveProperty('strasse');
		expect(pruefeKontakt({ ...gut, strasse: '', plz: '', ort: '' }, 'optional').werte).toMatchObject({ strasse: null });
		expect(pruefeKontakt({ ...gut, strasse: 'X' }, 'aus').werte).toMatchObject({ strasse: null });
		expect(pruefeKontakt({ ...gut, email: 'kein-at' }, 'aus').fehler).toHaveProperty('email');
		expect(pruefeKontakt({ ...gut, telefon: 'abc' }, 'aus').fehler).toHaveProperty('telefon');
		expect(telefonSchluessel('+49 (40) 123-456')).toBe('040123456');
		expect(telefonSchluessel('0049 40 123456')).toBe(telefonSchluessel('040/123456'));
	});

	it('Dienst: Grenzen und Standardwerte', () => {
		const d = pruefeDienstEingabe({ name: 'Besichtigung' });
		expect(d).toMatchObject({ dauerMin: 60, vorlaufMin: 1440, horizontTage: 60, maxProTag: null, modus: 'beliebig', ortArt: 'kunde', einsatzArt: 'besichtigung' });
		expect(() => pruefeDienstEingabe({ name: 'X', dauerMin: 3 })).toThrow(/Dauer/);
		expect(() => pruefeDienstEingabe({ name: '' })).toThrow(/Name/);
		expect(() => pruefeDienstEingabe({ name: 'X', ortArt: 'mond' })).toThrow(/Ort/);
	});

	it('Domains zum Einbetten: nur https, ohne Pfad, keine Kopfzeilen-Tricks', () => {
		expect(normaleDomain('www.beispiel.de/kontakt')).toBe('https://www.beispiel.de');
		expect(pruefeDomains('www.a.de\nhttps://b.de, *.c.de')).toEqual(['https://www.a.de', 'https://b.de', 'https://*.c.de']);
		expect(() => normaleDomain('http://a.de')).toThrow(/https/);
		expect(() => normaleDomain("a.de; script-src 'unsafe-inline'")).toThrow();
	});
});

describe('Schutz und Einbetten', () => {
	it('Zeitstempel: zu schnell, gültig, gefälscht, abgelaufen', () => {
		const jetzt = 1_800_000_000_000;
		const s = formStempel(jetzt);
		expect(pruefeStempel(s, jetzt + 1000)).toBe('zu_schnell');
		expect(pruefeStempel(s, jetzt + 10_000)).toBe('ok');
		expect(pruefeStempel(s.replace(/.$/, s.endsWith('A') ? 'B' : 'A'), jetzt + 10_000)).toBe('ungueltig');
		expect(pruefeStempel(s, jetzt + 13 * 3600_000)).toBe('ungueltig');
		expect(pruefeStempel(undefined)).toBe('ungueltig');
	});

	it('Verwaltungs-Token: nur der Hash wird gespeichert', () => {
		const { token, hash } = neuesVerwaltungsToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(verwaltungsHash(token)?.equals(hash)).toBe(true);
		expect(verwaltungsHash('zu-kurz')).toBeNull();
	});

	it('CSP frame-ancestors nur für erlaubte Ursprünge, X-Frame-Options entfällt', () => {
		const r = new Response('x', { headers: { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" } });
		const a = mitSicherheitsKopfzeilen(r, ['https://www.kunde.de', 'javascript:alert(1)', "https://x.de 'unsafe-inline'"]);
		expect(a.headers.get('content-security-policy')).toBe("default-src 'self'; frame-ancestors 'self' https://www.kunde.de");
		expect(a.headers.get('x-frame-options')).toBeNull();
		const normal = mitSicherheitsKopfzeilen(new Response('x', { headers: { 'content-security-policy': "frame-ancestors 'none'" } }));
		expect(normal.headers.get('x-frame-options')).toBe('DENY');
		expect(normal.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
	});

	it('Hausfarbe wird für weiße Schrift lesbar abgedunkelt', () => {
		expect(akzentLesbar('#0f6cbd')).toBe('#0f6cbd');
		expect(schriftAuf(akzentLesbar('#ffee00'))).toBe('#ffffff');
		expect(akzentLesbar('kaputt')).toBe('#0f6cbd');
	});
});

describe('Kalenderdatei (.ics)', () => {
	it('UTC-Zeiten, maskierte Texte, gefaltete Zeilen', () => {
		const ics = icsDatei({ uid: 'b1@x', beginn: new Date('2026-10-22T07:00:00Z'), ende: new Date('2026-10-22T08:00:00Z'), titel: 'Besichtigung; Bad, Küche', ort: 'Weg 1\nHH', jetzt: new Date('2026-10-20T10:00:00Z') });
		expect(ics).toContain('DTSTART:20261022T070000Z');
		expect(ics).toContain('SUMMARY:Besichtigung\\; Bad\\, Küche');
		expect(ics).toContain('LOCATION:Weg 1\\nHH');
		expect(ics.endsWith('\r\n')).toBe(true);
		const lang = falte('DESCRIPTION:' + 'ä'.repeat(100));
		for (const z of lang.split('\r\n')) expect(new TextEncoder().encode(z).length).toBeLessThanOrEqual(75);
	});
});

describe('Sprache (Ersatz-KI)', () => {
	const k = { heute: '2026-10-21', wochentag: 'Mittwoch' } as never;
	it('„Neuer Dienst Besichtigungstermin 60 Minuten für Murat“', () => {
		expect(deute('Neuer Dienst Besichtigungstermin 60 Minuten für Murat', k)).toEqual({
			aktion: 'dienst_anlegen',
			daten: { name: 'Besichtigungstermin', dauer_minuten: 60, mitarbeiter: ['Murat'] }
		});
		expect(deute('Neuer Dienst Vor-Ort-Termin eine Stunde für Ali und Murat', k)).toEqual({
			aktion: 'dienst_anlegen',
			daten: { name: 'Vor-Ort-Termin', dauer_minuten: 60, mitarbeiter: ['Ali', 'Murat'] }
		});
	});
	it('„Buchungslink für Besichtigung“', () => {
		expect(deute('Buchungslink für Besichtigung', k)).toEqual({ aktion: 'buchungslink_zeigen', daten: { dienst: 'Besichtigung' } });
		expect(deute('Zeig mir den Buchungslink', k)).toEqual({ aktion: 'buchungslink_zeigen', daten: {} });
	});
});
