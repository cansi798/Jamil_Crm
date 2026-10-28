import { describe, expect, it } from 'vitest';
import { erlaubteSortierungen, kundenAbzeichen, sortierungAus, type KundenZeilenInfo } from '../../src/lib/kunden-zeilen';

/** Infos in der Kundenzeile (Jamil msg 3522): Abzeichen, Reihenfolge, Rechte bei der Sortierung. */
const leer: KundenZeilenInfo = { auftraege: null, angebot: null, portal: null };

describe('kundenAbzeichen', () => {
	it('ohne Infos keine Abzeichen', () => {
		expect(kundenAbzeichen(null)).toEqual([]);
		expect(kundenAbzeichen(leer)).toEqual([]);
		expect(kundenAbzeichen({ ...leer, auftraege: { offen: 0, bestandskunde: false, naechsterTermin: null } })).toEqual([]);
	});

	it('Angebot: angenommen grün, offen mit Datum, abgelaufen als Warnung, abgelehnt leise', () => {
		const a = (status: 'versendet' | 'angenommen' | 'abgelehnt', abgelaufen = false) => kundenAbzeichen({ ...leer, angebot: { status, tag: '2026-10-21', abgelaufen } })[0];
		expect(a('angenommen')).toMatchObject({ ton: 'gut', text: 'Angebot angenommen 21.10.' });
		expect(a('versendet')).toMatchObject({ ton: 'neutral', text: 'Angebot offen seit 21.10.' });
		expect(a('versendet', true)).toMatchObject({ ton: 'warnung', text: 'Angebot abgelaufen' });
		expect(a('abgelehnt')).toMatchObject({ ton: 'leise', text: 'Angebot abgelehnt 21.10.' });
	});

	it('Portal: aktiv mit Zahl der Öffnungen, Passwort fehlt als Warnung, widerrufen = aus, nie eingerichtet = nichts', () => {
		const p = (x: Partial<NonNullable<KundenZeilenInfo['portal']>>) =>
			kundenAbzeichen({ ...leer, portal: { gueltig: true, jeEinLink: true, passwort: true, zugriffe: 0, zuletzt: null, ...x } });
		expect(p({ zugriffe: 5, zuletzt: '2026-10-27T11:52:00Z' })[0]).toMatchObject({ ton: 'gut', text: 'Portal aktiv · 5×' });
		expect(p({ zugriffe: 5, zuletzt: '2026-10-27T11:52:00Z' })[0].titel).toContain('5× geöffnet, zuletzt 27.10., 12:52');
		expect(p({})[0]).toMatchObject({ ton: 'neutral', text: 'Portal aktiv · 0×' });
		expect(p({ passwort: false })[0]).toMatchObject({ ton: 'warnung', text: 'Portal: Passwort fehlt' });
		expect(p({ gueltig: false })[0]).toMatchObject({ ton: 'leise', text: 'Portal aus' });
		expect(p({ gueltig: false, jeEinLink: false })).toEqual([]);
	});

	it('Reihenfolge Angebot · Portal · Aufträge · Termin · Bestandskunde', () => {
		const l = kundenAbzeichen({
			angebot: { status: 'angenommen', tag: '2026-10-21', abgelaufen: false },
			portal: { gueltig: true, jeEinLink: true, passwort: true, zugriffe: 2, zuletzt: null },
			auftraege: { offen: 2, bestandskunde: true, naechsterTermin: '2026-10-29T08:00:00Z' }
		});
		expect(l.map((a) => a.art)).toEqual(['angebot', 'portal', 'auftraege', 'termin', 'bestand']);
		expect(l[2].text).toBe('2 offene Aufträge');
		expect(l[3].text).toBe('Termin Do 29.10.');
	});
});

describe('Sortierung', () => {
	it('nur mit Recht wählbar, sonst Name', () => {
		const ohne = { auftraege: false, angebote: false, portal: false };
		expect(erlaubteSortierungen(ohne).map((s) => s.wert)).toEqual(['name']);
		expect(sortierungAus('portal', ohne)).toBe('name');
		expect(sortierungAus('portal', { ...ohne, portal: true })).toBe('portal');
		expect(sortierungAus("name'; drop table", { auftraege: true, angebote: true, portal: true })).toBe('name');
	});
});
