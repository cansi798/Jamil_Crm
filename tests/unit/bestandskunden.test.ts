import { describe, expect, it } from 'vitest';
import { BESTAND_AB_WAHL, BESTAND_GRENZEN, BESTAND_STANDARD_TITEL, bestandAusDatenbank, bestandKarteFuer, bestandStandard, bestandStatusAb, pruefeBestand, pruefeLink } from '../../src/lib/bestandskunden';

/** Leistungen für Bestandskunden im Kundenportal (Jamil, Talk msg 3408): Link-Prüfung, Eingaben, Anzeige-Logik. */
describe('pruefeLink', () => {
	it('lässt https, mailto und tel zu', () => {
		expect(pruefeLink('https://www.beispiel.de/anfrage?x=1')).toEqual({ ok: true, url: 'https://www.beispiel.de/anfrage?x=1' });
		expect(pruefeLink('  HTTPS://Beispiel.de ')).toEqual({ ok: true, url: 'https://beispiel.de/' });
		expect(pruefeLink('mailto:info@beispiel.de')).toEqual({ ok: true, url: 'mailto:info@beispiel.de' });
		expect(pruefeLink('tel:+49 40 123456')).toMatchObject({ ok: false }); // Leerzeichen nicht zulässig
		expect(pruefeLink('tel:+4940123456')).toEqual({ ok: true, url: 'tel:+4940123456' });
		expect(pruefeLink('tel:040/123-456')).toEqual({ ok: true, url: 'tel:040123456' });
	});

	it.each([
		'javascript:alert(1)',
		'JavaScript:alert(1)',
		' javascript:alert(1)',
		'java\nscript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:x',
		'http://beispiel.de',
		'ftp://beispiel.de',
		'//beispiel.de',
		'beispiel.de',
		'https://',
		'https://localhost',
		'https://user:pw@beispiel.de',
		'https://beispiel.de/"onmouseover="x',
		'https://beispiel.de/<script>',
		'mailto:a@b',
		'mailto:a@b.de,c@d.de',
		'mailto:a@b.de?cc=x@y.de',
		'tel:abc',
		'tel:12',
		'',
		'   '
	])('weist %j ab', (w) => {
		expect(pruefeLink(w).ok).toBe(false);
	});

	it('weist zu lange Adressen und Nicht-Texte ab', () => {
		expect(pruefeLink(`https://beispiel.de/${'a'.repeat(500)}`).ok).toBe(false);
		expect(pruefeLink(null).ok).toBe(false);
		expect(pruefeLink({}).ok).toBe(false);
	});
});

describe('pruefeBestand', () => {
	const gut = { aktiv: true, titel: ' Wir sind  für Sie da ', text: 'Kurzer Text', leistungen: [{ titel: 'Winterdienst', text: '', symbol: 'winter' }], knoepfe: [{ text: 'Termin anfragen', url: 'https://beispiel.de/anfrage' }] };

	it('übernimmt gültige Eingaben und bereinigt Leerraum', () => {
		const r = pruefeBestand(gut);
		expect(r).toEqual({ ok: true, wert: { ...gut, ab: 'abgerechnet', titel: 'Wir sind für Sie da' } });
	});

	it('nimmt den Standardtitel, wenn die Überschrift leer ist, und ein bekanntes Symbol', () => {
		const r = pruefeBestand({ ...gut, titel: '  ', leistungen: [{ titel: 'X', symbol: '<script>' }] });
		expect(r.ok && r.wert.titel).toBe(BESTAND_STANDARD_TITEL);
		expect(r.ok && r.wert.leistungen[0].symbol).toBe('stern');
	});

	it('Schalter: nur ausdrücklich true/ja/on schaltet ein', () => {
		expect(pruefeBestand({ ...gut, aktiv: false })).toMatchObject({ ok: true, wert: { aktiv: false } });
		expect(pruefeBestand({ ...gut, aktiv: 'ja' })).toMatchObject({ ok: true, wert: { aktiv: true } });
		expect(pruefeBestand({ titel: 'x' })).toMatchObject({ ok: true, wert: { aktiv: false, leistungen: [], knoepfe: [] } });
	});

	it('prüft Längen und Anzahl', () => {
		const G = BESTAND_GRENZEN;
		expect(pruefeBestand({ ...gut, titel: 'x'.repeat(G.titel + 1) }).ok).toBe(false);
		expect(pruefeBestand({ ...gut, text: 'x'.repeat(G.text + 1) }).ok).toBe(false);
		expect(pruefeBestand({ ...gut, leistungen: [{ titel: 'x'.repeat(G.leistungTitel + 1) }] }).ok).toBe(false);
		expect(pruefeBestand({ ...gut, leistungen: [{ titel: 'a', text: 'x'.repeat(G.leistungText + 1) }] }).ok).toBe(false);
		expect(pruefeBestand({ ...gut, leistungen: Array.from({ length: G.leistungen + 1 }, () => ({ titel: 'a' })) }).ok).toBe(false);
		expect(pruefeBestand({ ...gut, leistungen: Array.from({ length: G.leistungen }, () => ({ titel: 'a' })) }).ok).toBe(true);
		expect(pruefeBestand({ ...gut, knoepfe: Array.from({ length: G.knoepfe + 1 }, () => gut.knoepfe[0]) }).ok).toBe(false);
		expect(pruefeBestand({ ...gut, knoepfe: [{ text: 'x'.repeat(G.knopfText + 1), url: 'https://beispiel.de' }] }).ok).toBe(false);
	});

	it('verlangt Titel bei Leistungen sowie Beschriftung und gültigen Link bei Knöpfen', () => {
		expect(pruefeBestand({ ...gut, leistungen: [{ titel: '  ' }] })).toMatchObject({ ok: false, fehler: expect.stringContaining('Leistung 1') });
		expect(pruefeBestand({ ...gut, knoepfe: [{ text: '', url: 'https://beispiel.de' }] })).toMatchObject({ ok: false, fehler: expect.stringContaining('Beschriftung') });
		const r = pruefeBestand({ ...gut, knoepfe: [{ text: 'Los', url: 'javascript:alert(1)' }] });
		expect(r).toMatchObject({ ok: false, fehler: expect.stringContaining('Knopf 1') });
	});

	it('hält Fremdes fern: Steuerzeichen raus, HTML bleibt reiner Text, Unsinn wird nicht übernommen', () => {
		const r = pruefeBestand({ ...gut, titel: 'A\u0000B\nC', text: '<img src=x onerror=alert(1)>' });
		expect(r.ok && r.wert.titel).toBe('A B C');
		expect(r.ok && r.wert.text).toBe('<img src=x onerror=alert(1)>'); // wird im Portal nur als Text ausgegeben (kein {@html})
		expect(pruefeBestand('kaputt')).toMatchObject({ ok: true, wert: { leistungen: [], knoepfe: [] } });
		expect(pruefeBestand({ ...gut, leistungen: 'x', knoepfe: 5 })).toMatchObject({ ok: true, wert: { leistungen: [], knoepfe: [] } });
	});
});

describe('Anzeige-Logik', () => {
	const e = bestandStandard();

	it('nur bei eingeschalteter Karte UND abgeschlossenem Auftrag', () => {
		expect(bestandKarteFuer(e, true)).toMatchObject({ titel: BESTAND_STANDARD_TITEL });
		expect(bestandKarteFuer(e, false)).toBeNull();
		expect(bestandKarteFuer({ ...e, aktiv: false }, true)).toBeNull();
		expect(bestandKarteFuer({ ...e, aktiv: false }, false)).toBeNull();
	});

	it('ganz leere Karte wird nicht gezeigt, Text oder Knopf oder Leistung genügt', () => {
		const leer = { ...e, text: '', leistungen: [], knoepfe: [] };
		expect(bestandKarteFuer(leer, true)).toBeNull();
		expect(bestandKarteFuer({ ...leer, text: 'Hallo' }, true)).not.toBeNull();
		expect(bestandKarteFuer({ ...leer, knoepfe: [{ text: 'a', url: 'https://b.de/' }] }, true)).not.toBeNull();
	});

	it('Standard: an, sechs Leistungen, keine Knöpfe, neutraler Titel ohne „Bestandskunden“', () => {
		expect(e.aktiv).toBe(true);
		expect(e.leistungen).toHaveLength(6);
		expect(e.knoepfe).toEqual([]);
		expect(e.titel).not.toMatch(/bestandskunde/i);
	});

	it('aus der Datenbank: ohne Zeile Standard, NULL = Standard, [] = bewusst leer, Kaputtes fällt zurück', () => {
		expect(bestandAusDatenbank(undefined)).toEqual(e);
		expect(bestandAusDatenbank({ bestand_aktiv: true, bestand_titel: null, bestand_text: null, bestand_leistungen: null, bestand_knoepfe: null })).toEqual(e);
		expect(bestandAusDatenbank({ bestand_aktiv: false, bestand_titel: 'T', bestand_text: '', bestand_leistungen: [], bestand_knoepfe: [] })).toEqual({ aktiv: false, ab: 'abgerechnet', titel: 'T', text: '', leistungen: [], knoepfe: [] });
		expect(bestandAusDatenbank({ bestand_aktiv: false, bestand_titel: 'T', bestand_leistungen: [{ titel: '' }] })).toEqual({ ...e, aktiv: false });
	});
});

describe('Ab wann erscheint die Karte (Jamil msg 3521 B)', () => {
	it('Standard abgerechnet, „immer“ und jeder Auftragsstatus wählbar; Unsinn → Fehler', () => {
		expect(bestandStandard().ab).toBe('abgerechnet');
		expect(pruefeBestand({ titel: 'x', ab: 'immer' })).toMatchObject({ ok: true, wert: { ab: 'immer' } });
		expect(pruefeBestand({ titel: 'x', ab: 'abgenommen' })).toMatchObject({ ok: true, wert: { ab: 'abgenommen' } });
		expect(pruefeBestand({ titel: 'x', ab: 'bald' })).toMatchObject({ ok: false });
		expect(pruefeBestand({ titel: 'x' })).toMatchObject({ ok: true, wert: { ab: 'abgerechnet' } });
		expect(BESTAND_AB_WAHL.map((w) => w.wert)).toEqual(['immer', 'anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet']);
	});
	it('zählende Status: der gewählte und alle späteren; „immer“ braucht keinen Auftrag', () => {
		expect(bestandStatusAb('abgenommen')).toEqual(['abgenommen', 'abgerechnet']);
		expect(bestandStatusAb('abgerechnet')).toEqual(['abgerechnet']);
		expect(bestandStatusAb('immer')).toEqual([]);
		expect(bestandAusDatenbank({ bestand_ab: 'immer' }).ab).toBe('immer');
		expect(bestandAusDatenbank({ bestand_ab: 'quatsch' }).ab).toBe('abgerechnet');
	});
});
