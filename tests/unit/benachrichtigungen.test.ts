import { describe, expect, it } from 'vitest';
import { BENACHRICHTIGUNGS_KATEGORIEN, glockenText, istBenachrichtigungsKategorie } from '../../src/lib/benachrichtigungen';

describe('Benachrichtigungen (Jamil msg 3734)', () => {
	it('Kategorien wie in der Datenbank (Migration 114)', () => {
		expect(BENACHRICHTIGUNGS_KATEGORIEN.map((k) => k.id)).toEqual(['aufgabe', 'termin', 'auftrag']);
		expect(istBenachrichtigungsKategorie('termin')).toBe(true);
		expect(istBenachrichtigungsKategorie('kunde')).toBe(false);
	});
	it('gebündelte Nachricht zeigt die Anzahl', () => {
		expect(glockenText('jetzt 03.11.2026, 08:00 Uhr', 1)).toBe('jetzt 03.11.2026, 08:00 Uhr');
		expect(glockenText('jetzt 03.11.2026, 08:00 Uhr', 3)).toBe('jetzt 03.11.2026, 08:00 Uhr · 3 Änderungen');
		expect(glockenText(null, 2)).toBe('2 Änderungen');
		expect(glockenText(null, 1)).toBeNull();
	});
});
