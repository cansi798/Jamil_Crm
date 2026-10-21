import { describe, expect, it } from 'vitest';
import { aenderungen, erzeugeVtodo, etagVon, felderVon, leseVtodo, type CalAufgabe } from '../../src/lib/server/caldav/vtodo';
import { leseXml, XmlFehler, kind, NS, multistatus, propResponse } from '../../src/lib/server/caldav/xml';
import { zielVon } from '../../src/lib/server/caldav/server';

const basis: CalAufgabe = {
	id: '0b6f6c1e-8b1a-4c1e-9e1a-1a2b3c4d5e6f',
	uid: '0b6f6c1e-8b1a-4c1e-9e1a-1a2b3c4d5e6f',
	titel: 'Fliesen; Bad, oben',
	beschreibung: 'Zeile 1\nZeile 2 mit Ümlaut',
	faellig: null,
	faelligZeit: null,
	vonTag: null,
	vonZeit: null,
	erledigtAm: null,
	prioritaet: null,
	auftrag: null,
	kundeName: null,
	wiederkehrend: false,
	erinnerungen: [],
	angelegt: '2026-10-01T08:00:00.000Z',
	geaendert: '2026-10-02T09:30:00.000Z',
	link: null
};

const kal = (inhalt: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//DE', ...inhalt, 'END:VCALENDAR'].join('\r\n') + '\r\n';
const todo = (zeilen: string[]) => kal(['BEGIN:VTODO', 'UID:abc-123', 'DTSTAMP:20261001T000000Z', ...zeilen, 'END:VTODO']);

describe('CalDAV: Aufgabe → VTODO', () => {
	it('maskiert Texte, setzt UID, Status und keine Fälligkeit', () => {
		const ics = erzeugeVtodo(basis);
		expect(ics).toContain('SUMMARY:Fliesen\\; Bad\\, oben');
		expect(ics).toContain('DESCRIPTION:Zeile 1\\nZeile 2 mit Ümlaut');
		expect(ics).toContain(`UID:${basis.uid}`);
		expect(ics).toContain('STATUS:NEEDS-ACTION');
		expect(ics).not.toContain('DUE');
		expect(ics.endsWith('\r\n')).toBe(true);
		expect(ics.split('\r\n').every((z) => new TextEncoder().encode(z).length <= 75)).toBe(true);
	});

	it('Tag → DUE;VALUE=DATE (offen mit Fälligkeit = In Arbeit), Uhrzeit → UTC', () => {
		expect(erzeugeVtodo({ ...basis, faellig: '2026-10-22' })).toMatch(/DUE;VALUE=DATE:20261022\r\nSTATUS:IN-PROCESS/);
		// 22.10. 09:15 Berlin (Sommerzeit) = 07:15 UTC
		expect(erzeugeVtodo({ ...basis, faellig: '2026-10-22', faelligZeit: '09:15' })).toContain('DUE:20261022T071500Z');
		// Winterzeit: 10.12. 09:15 = 08:15 UTC
		expect(erzeugeVtodo({ ...basis, faellig: '2026-12-10', faelligZeit: '09:15' })).toContain('DUE:20261210T081500Z');
	});

	it('Zeitraum → DTSTART + DUE (Tage bzw. Zeitpunkte)', () => {
		const tage = erzeugeVtodo({ ...basis, vonTag: '2026-10-20', faellig: '2026-10-23' });
		expect(tage).toContain('DTSTART;VALUE=DATE:20261020');
		expect(tage).toContain('DUE;VALUE=DATE:20261023');
		const zeiten = erzeugeVtodo({ ...basis, vonTag: '2026-10-20', vonZeit: '07:00', faellig: '2026-10-23', faelligZeit: '16:00' });
		expect(zeiten).toContain('DTSTART:20261020T050000Z');
		expect(zeiten).toContain('DUE:20261023T140000Z');
	});

	it('erledigt → COMPLETED mit Zeitpunkt; Priorität, Kategorien, URL, Erinnerungen', () => {
		const ics = erzeugeVtodo({
			...basis,
			erledigtAm: '2026-10-05T10:00:00.000Z',
			prioritaet: 1,
			auftrag: { id: 'x', nummer: 'A-2026-0007', titel: 'Bad Müller' },
			kundeName: 'Müller, Hans',
			wiederkehrend: true,
			link: 'https://crm.example.de/auftraege/x',
			erinnerungen: ['2026-10-21T06:00:00.000Z']
		});
		expect(ics).toContain('STATUS:COMPLETED');
		expect(ics).toContain('COMPLETED:20261005T100000Z');
		expect(ics).toContain('PERCENT-COMPLETE:100');
		expect(ics).toContain('PRIORITY:1');
		expect(ics).toContain('CATEGORIES:A-2026-0007 Bad Müller,Müller\\, Hans,Wiederkehrend');
		expect(ics).toContain('URL:https://crm.example.de/auftraege/x');
		expect(ics).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]*\r\nTRIGGER;VALUE=DATE-TIME:20261021T060000Z\r\nEND:VALARM/);
	});

	it('ETag ändert sich mit dem Inhalt und ist stabil', () => {
		expect(etagVon(erzeugeVtodo(basis))).toBe(etagVon(erzeugeVtodo(basis)));
		expect(etagVon(erzeugeVtodo(basis))).not.toBe(etagVon(erzeugeVtodo({ ...basis, titel: 'anders' })));
		expect(etagVon(erzeugeVtodo(basis))).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
	});
});

describe('CalDAV: VTODO → Aufgabe', () => {
	it('Rundreise ohne Änderung ergibt keine Änderung (auch mit Zeitraum, Erinnerung, Erledigt)', () => {
		for (const t of [
			basis,
			{ ...basis, faellig: '2026-10-22' },
			{ ...basis, faellig: '2026-10-22', faelligZeit: '09:15', erinnerungen: ['2026-10-22T06:00:00.000Z'] },
			{ ...basis, vonTag: '2026-10-20', faellig: '2026-10-23', faelligZeit: '16:00' },
			{ ...basis, erledigtAm: '2026-10-05T10:00:00.000Z', prioritaet: 5 }
		]) {
			const alt = felderVon(t);
			const neu = leseVtodo(erzeugeVtodo(t));
			expect(aenderungen(alt, neu)).toEqual({});
		}
	});

	it('liest Titel, Beschreibung, Tag-Fälligkeit, Status und Priorität', () => {
		const g = leseVtodo(todo(['SUMMARY:Silikon\\, Fugen', 'DESCRIPTION:a\\nb', 'DUE;VALUE=DATE:20261024', 'STATUS:NEEDS-ACTION', 'PRIORITY:9']));
		expect(g).toMatchObject({ uid: 'abc-123', titel: 'Silikon, Fugen', beschreibung: 'a\nb', faellig: '2026-10-24', faelligZeit: null, erledigt: false, prioritaet: 9 });
	});

	it('Zeitzonen: UTC, TZID mit VTIMEZONE, schwebend (= Berlin)', () => {
		expect(leseVtodo(todo(['SUMMARY:x', 'DUE:20261024T120000Z']))).toMatchObject({ faellig: '2026-10-24', faelligZeit: '14:00' });
		const vtz = [
			'BEGIN:VTIMEZONE', 'TZID:America/New_York',
			'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'DTSTART:20070311T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
			'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'DTSTART:20071104T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
			'END:VTIMEZONE'
		];
		const ny = kal([...vtz, 'BEGIN:VTODO', 'UID:u1', 'SUMMARY:x', 'DUE;TZID=America/New_York:20261024T080000', 'END:VTODO']);
		// 08:00 New York (EDT, −4) = 12:00 UTC = 14:00 Berlin
		expect(leseVtodo(ny)).toMatchObject({ faellig: '2026-10-24', faelligZeit: '14:00' });
		expect(leseVtodo(todo(['SUMMARY:x', 'DUE:20261024T080000']))).toMatchObject({ faelligZeit: '08:00' });
		expect(leseVtodo(todo(['SUMMARY:x', 'DUE;TZID=Europe/Berlin:20261024T080000']))).toMatchObject({ faelligZeit: '08:00' });
	});

	it('Erledigt: STATUS:COMPLETED oder nur COMPLETED; IN-PROCESS bleibt offen', () => {
		expect(leseVtodo(todo(['SUMMARY:x', 'STATUS:COMPLETED'])).erledigt).toBe(true);
		expect(leseVtodo(todo(['SUMMARY:x', 'COMPLETED:20261020T100000Z'])).erledigt).toBe(true);
		expect(leseVtodo(todo(['SUMMARY:x', 'STATUS:IN-PROCESS'])).erledigt).toBe(false);
	});

	it('Zeitraum: DTSTART bis DUE; nur DTSTART wird Fälligkeit; Beginn nach Ende fällt weg', () => {
		expect(leseVtodo(todo(['SUMMARY:x', 'DTSTART;VALUE=DATE:20261020', 'DUE;VALUE=DATE:20261023']))).toMatchObject({ vonTag: '2026-10-20', faellig: '2026-10-23' });
		expect(leseVtodo(todo(['SUMMARY:x', 'DTSTART;VALUE=DATE:20261020']))).toMatchObject({ vonTag: null, faellig: '2026-10-20' });
		expect(leseVtodo(todo(['SUMMARY:x', 'DTSTART;VALUE=DATE:20261025', 'DUE;VALUE=DATE:20261023']))).toMatchObject({ vonTag: null, faellig: '2026-10-23' });
	});

	it('iPhone-Muster DTSTART = DUE ist kein Zeitraum', () => {
		expect(leseVtodo(todo(['SUMMARY:x', 'DTSTART;VALUE=DATE:20261022', 'DUE;VALUE=DATE:20261022']))).toMatchObject({ vonTag: null, faellig: '2026-10-22', faelligZeit: null });
		expect(leseVtodo(todo(['SUMMARY:x', 'DTSTART:20261022T070000Z', 'DUE:20261022T070000Z']))).toMatchObject({ vonTag: null, vonZeit: null, faellig: '2026-10-22', faelligZeit: '09:00' });
		expect(leseVtodo(todo(['SUMMARY:x', 'DTSTART:20261022T060000Z', 'DUE:20261022T070000Z']))).toMatchObject({ vonTag: '2026-10-22', vonZeit: '08:00', faelligZeit: '09:00' });
	});

	it('Erinnerungen: fest und relativ zur Fälligkeit', () => {
		const g = leseVtodo(
			todo([
				'SUMMARY:x',
				'DUE:20261024T120000Z',
				'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;VALUE=DATE-TIME:20261024T060000Z', 'END:VALARM',
				'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;RELATED=END:-PT1H', 'END:VALARM',
				'BEGIN:VALARM', 'ACTION:NONE', 'TRIGGER:-PT2H', 'END:VALARM'
			])
		);
		expect(g.erinnerungen).toEqual([Date.parse('2026-10-24T06:00:00Z'), Date.parse('2026-10-24T11:00:00Z')]);
	});

	it('kürzt zu lange Texte statt zu scheitern; RRULE wird erkannt', () => {
		const g = leseVtodo(todo([`SUMMARY:${'a'.repeat(300)}`, `DESCRIPTION:${'b'.repeat(900)}`, 'RRULE:FREQ=WEEKLY']));
		expect([...g.titel].length).toBe(200);
		expect([...(g.beschreibung ?? '')].length).toBe(500);
		expect(g.wiederholung).toBe(true);
	});

	it('lehnt Unsinn ab: kein iCalendar, kein VTODO, VEVENT, zwei UIDs', () => {
		expect(() => leseVtodo('hallo')).toThrow();
		expect(() => leseVtodo(kal([]))).toThrow(/VTODO/);
		expect(() => leseVtodo(kal(['BEGIN:VEVENT', 'UID:e', 'END:VEVENT', 'BEGIN:VTODO', 'UID:e', 'END:VTODO']))).toThrow();
		expect(() => leseVtodo(kal(['BEGIN:VTODO', 'UID:a', 'END:VTODO', 'BEGIN:VTODO', 'UID:b', 'END:VTODO']))).toThrow(/UID/);
	});

	it('aenderungen meldet nur Geändertes', () => {
		const alt = felderVon({ ...basis, faellig: '2026-10-22' });
		const neu = leseVtodo(erzeugeVtodo({ ...basis, faellig: '2026-10-22', titel: 'Neu', erledigtAm: '2026-10-21T10:00:00Z' }));
		expect(aenderungen(alt, neu)).toEqual({ titel: 'Neu', erledigt: true });
		const verschoben = leseVtodo(erzeugeVtodo({ ...basis, faellig: '2026-10-25', faelligZeit: '10:00' }));
		expect(aenderungen(alt, verschoben)).toEqual({ zeit: { faellig: '2026-10-25', faelligZeit: '10:00', vonTag: null, vonZeit: null } });
	});
});

describe('CalDAV: XML gehärtet', () => {
	it('liest Namensräume unabhängig vom Präfix', () => {
		const x = leseXml('<?xml version="1.0"?><A:propfind xmlns:A="DAV:"><A:prop><B:getctag xmlns:B="http://calendarserver.org/ns/"/></A:prop></A:propfind>');
		expect(x).toMatchObject({ ns: NS.dav, name: 'propfind' });
		expect(kind(kind(x, NS.dav, 'prop'), NS.cs, 'getctag')).toBeTruthy();
		const y = leseXml('<propfind xmlns="DAV:"><prop><displayname/></prop></propfind>');
		expect(kind(kind(y, NS.dav, 'prop'), NS.dav, 'displayname')).toBeTruthy();
	});

	it('weist DOCTYPE, Entitäten (XXE, Bombe) und Unsinn ab', () => {
		const xxe = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d:propfind xmlns:d="DAV:">&x;</d:propfind>';
		expect(() => leseXml(xxe)).toThrow(XmlFehler);
		const bombe = '<!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><l>&b;</l>';
		expect(() => leseXml(bombe)).toThrow(XmlFehler);
		expect(() => leseXml('<d:p xmlns:d="DAV:">&unbekannt;</d:p>')).toThrow(XmlFehler);
		expect(() => leseXml('<a><b></a>')).toThrow(XmlFehler);
		expect(() => leseXml('<a/><b/>')).toThrow(XmlFehler);
		expect(() => leseXml('<?xml-stylesheet href="x"?><a/>')).toThrow(XmlFehler);
		expect(() => leseXml('<a>' + '<b>'.repeat(60) + '</b>'.repeat(60) + '</a>')).toThrow(/tief/);
		expect(() => leseXml(`<a>${'<b/>'.repeat(6000)}</a>`)).toThrow(/viele/);
		expect(leseXml('')).toBeNull();
	});

	it('maskiert Ausgaben', () => {
		const x = multistatus([propResponse({ href: '/a&b', gefunden: [[{ ns: NS.dav, name: 'displayname' }, 'x&lt;y']], fehlend: [{ ns: 'urn:x', name: 'foo' }] })]);
		expect(x).toContain('<d:href>/a&amp;b</d:href>');
		expect(x).toContain('<x:foo xmlns:x="urn:x"/>');
		expect(x).toContain('HTTP/1.1 404 Not Found');
	});
});

describe('CalDAV: Pfade', () => {
	const ich = '0b6f6c1e-8b1a-4c1e-9e1a-1a2b3c4d5e6f';
	const fremd = '11111111-1111-4111-8111-111111111111';
	it('erkennt Wurzel, Principal, Listen und Objekte – nur für den angemeldeten Benutzer', () => {
		expect(zielVon('/caldav', ich)).toEqual({ art: 'wurzel' });
		expect(zielVon('/caldav/', ich)).toEqual({ art: 'wurzel' });
		expect(zielVon(`/caldav/nutzer/${ich}/`, ich)).toEqual({ art: 'principal' });
		expect(zielVon(`/caldav/listen/${ich}/`, ich)).toEqual({ art: 'heim' });
		expect(zielVon(`/caldav/listen/${ich}/meine/`, ich)).toEqual({ art: 'liste', sammlung: 'meine' });
		expect(zielVon(`/caldav/listen/${ich}/meine/a%20b.ics`, ich)).toEqual({ art: 'objekt', sammlung: 'meine', name: 'a b.ics' });
		expect(zielVon(`/caldav/nutzer/${fremd}/`, ich)).toBeNull();
		expect(zielVon(`/caldav/listen/${fremd}/meine/`, ich)).toBeNull();
		expect(zielVon(`/caldav/listen/${ich}/meine/x.ics/zu-tief`, ich)).toBeNull();
		expect(zielVon('/caldav/%E0%A4%A', ich)).toBeNull();
		expect(zielVon('/anderswo', ich)).toBeNull();
	});
});
