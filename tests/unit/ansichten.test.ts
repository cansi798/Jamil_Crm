import { describe, expect, it } from 'vitest';
import { filterQuery, querySchluessel } from '../../src/lib/ansichten';
import { normalisiereQuery } from '../../src/lib/server/ansichten';

describe('Gespeicherte Ansichten (Jamil msgs 2830, 2921) – Filter-Teil der Adresse', () => {
	it('ohne „?“, ohne leere Werte; Plantafel ohne Tag, Zeiten ohne Tag/Monat; Mehrfachwerte bleiben', () => {
		expect(filterQuery('auftraege', '?status=beauftragt&suche=&quelle=q1')).toBe('status=beauftragt&quelle=q1');
		expect(filterQuery('plantafel', 'tag=2026-10-21&ansicht=woche&ma=a&ma=b')).toBe('ansicht=woche&ma=a&ma=b');
		expect(filterQuery('zeiten', 'monat=2026-10&ansicht=monat&person=x&tag=2026-10-01')).toBe('ansicht=monat&person=x');
	});

	it('Vergleich unabhängig von der Reihenfolge', () => {
		expect(querySchluessel('karte', 'status=a&ma=x')).toBe(querySchluessel('karte', '?ma=x&status=a&von='));
		expect(querySchluessel('plantafel', 'tag=2026-01-01&ansicht=tag')).toBe(querySchluessel('plantafel', 'ansicht=tag'));
	});

	it('Server: kodiert alles, verwirft seltsame Schlüssel, begrenzt Länge und Anzahl', () => {
		expect(normalisiereQuery('suche=Müller "x" <b>&status=a', 'kunden')).toBe('suche=M%C3%BCller+%22x%22+%3Cb%3E&status=a');
		// Schlüssel nur aus Buchstaben/Ziffern/_ und mit Buchstaben vorn: „a b“ und „__proto__“ fallen weg
		expect(normalisiereQuery('a b=1&__proto__=x&ok=1')).toBe('ok=1');
		expect(() => normalisiereQuery(Array.from({ length: 31 }, (_, i) => `k${i}=1`).join('&'))).toThrow(/Zu viele/);
		expect(() => normalisiereQuery(`suche=${'x'.repeat(5000)}`)).toThrow(/Zu viele/);
		expect(() => normalisiereQuery(42)).toThrow(/Ungültige/);
	});
});
