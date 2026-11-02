import { describe, expect, it } from 'vitest';
import {
	fehlendePflicht,
	fortschritt,
	giltFuer,
	istErledigt,
	kundenWert,
	neueSchrittId,
	pruefeSchritte,
	pruefeWert,
	STARTVORLAGE,
	uebernimm,
	zusammenfassung,
	type LeitfadenKunde,
	type Schritt
} from '../../src/lib/leitfaden';

/** Leitfaden beim Termin (Jamil msgs 4302/4304, Entscheidungen 4340: 1c / 2b / 3a / 4b). */
const KUNDE_LEER: LeitfadenKunde = { email: null, telefon: null, bevorzugter_kontakt: null, strasse: null, plz: null, ort: null };
const KUNDE_VOLL: LeitfadenKunde = { email: 'a@b.de', telefon: '0171', bevorzugter_kontakt: 'chat', strasse: 'Weg 1', plz: '12345', ort: 'Kiel' };
const Z = (min: number) => new Date(Date.UTC(2026, 10, 3, 8, min)).toISOString();

describe('Startvorlage', () => {
	it('ist gültig und enthält Jamils Beispiele: E-Mail, Kontaktweg, Fotos, Fragen, Aufgabe', () => {
		const s = pruefeSchritte(STARTVORLAGE);
		expect(s).toEqual(STARTVORLAGE);
		expect(s.filter((x) => x.typ === 'kundendaten').map((x) => x.feld)).toEqual(['email', 'bevorzugter_kontakt', 'telefon']);
		expect(s.some((x) => x.typ === 'foto' && x.pflicht)).toBe(true);
		expect(s.some((x) => x.typ === 'aufgabe')).toBe(true);
	});
});

describe('pruefeSchritte', () => {
	const gut = { id: 'a', typ: 'frage', titel: 'Frage?', pflicht: true };
	it('leer, zu viele, doppelte Kennung, unbekannte Art, fehlender Titel → Fehler', () => {
		expect(() => pruefeSchritte([])).toThrow(/mindestens einen/);
		expect(() => pruefeSchritte(Array.from({ length: 41 }, (_, i) => ({ ...gut, id: `x${i}` })))).toThrow(/Höchstens/);
		expect(() => pruefeSchritte([gut, gut])).toThrow(/doppelt/);
		expect(() => pruefeSchritte([{ ...gut, typ: 'zauber' }])).toThrow(/unbekannte Art/);
		expect(() => pruefeSchritte([{ ...gut, titel: '  ' }])).toThrow(/Titel/);
		expect(() => pruefeSchritte([{ ...gut, id: 'A B' }])).toThrow(/Kennung/);
	});
	it('Hinweis ist nie Pflicht; Auswahl braucht zwei Antworten; Kundendaten brauchen ein Feld; Foto 1–20', () => {
		expect(pruefeSchritte([{ id: 'h', typ: 'hinweis', titel: 'Hi', pflicht: true }])[0].pflicht).toBe(false);
		expect(() => pruefeSchritte([{ ...gut, antwortArt: 'auswahl', optionen: ['nur eine'] }])).toThrow(/zwei Antworten/);
		expect(pruefeSchritte([{ ...gut, antwortArt: 'auswahl', optionen: ['a', 'b', 'a', ''] }])[0].optionen).toEqual(['a', 'b']);
		expect(() => pruefeSchritte([{ id: 'k', typ: 'kundendaten', titel: 'K', pflicht: true }])).toThrow(/Kundendaten/);
		expect(pruefeSchritte([{ id: 'f', typ: 'foto', titel: 'F', pflicht: true, mindestens: 99 }])[0].mindestens).toBe(1);
		expect(pruefeSchritte([{ id: 'f', typ: 'foto', titel: 'F', pflicht: true, mindestens: 3 }])[0].mindestens).toBe(3);
		expect(pruefeSchritte([{ id: 't', typ: 'aufgabe', titel: 'Angebot', pflicht: false }])[0].aufgabeTitel).toBe('Angebot');
	});
	it('neueSchrittId findet eine freie Kennung', () => {
		expect(neueSchrittId(['frage-1', 'frage-2'], 'frage')).toBe('frage-3');
		expect(neueSchrittId([], 'foto')).toBe('foto-1');
	});
});

describe('erledigt, Pflicht, Fortschritt', () => {
	const s = (x: Partial<Schritt>): Schritt => ({ id: 'x', typ: 'frage', titel: 'T', pflicht: true, ...x });
	it('Kundendaten zählen, sobald sie in der Kundenakte stehen', () => {
		const email = s({ typ: 'kundendaten', feld: 'email' });
		expect(istErledigt(email, undefined, KUNDE_LEER)).toBe(false);
		expect(istErledigt(email, undefined, KUNDE_VOLL)).toBe(true);
		expect(istErledigt(s({ typ: 'kundendaten', feld: 'adresse' }), undefined, { ...KUNDE_LEER, ort: 'Kiel' })).toBe(true);
		expect(kundenWert('adresse', KUNDE_LEER)).toBeNull();
	});
	it('Frage/Notiz: Text; Abhaken: true; Foto: Mindestanzahl; Aufgabe: entschieden; Hinweis immer', () => {
		expect(istErledigt(s({}), { wert: '  ', zeit: Z(0) }, null)).toBe(false);
		expect(istErledigt(s({}), { wert: 'Bad neu', zeit: Z(0) }, null)).toBe(true);
		expect(istErledigt(s({ typ: 'abhaken' }), { wert: false, zeit: Z(0) }, null)).toBe(false);
		expect(istErledigt(s({ typ: 'abhaken' }), { wert: true, zeit: Z(0) }, null)).toBe(true);
		expect(istErledigt(s({ typ: 'foto', mindestens: 2 }), { wert: ['d1'], zeit: Z(0) }, null)).toBe(false);
		expect(istErledigt(s({ typ: 'foto', mindestens: 2 }), { wert: ['d1', 'd2'], zeit: Z(0) }, null)).toBe(true);
		expect(istErledigt(s({ typ: 'aufgabe' }), { wert: { anlegen: false, titel: 'x' }, zeit: Z(0) }, null)).toBe(true);
		expect(istErledigt(s({ typ: 'hinweis', pflicht: false }), undefined, null)).toBe(true);
	});
	it('fehlendePflicht und fortschritt mit der Startvorlage', () => {
		const offen = fehlendePflicht(STARTVORLAGE, {}, KUNDE_LEER).map((x) => x.id);
		expect(offen).toEqual(['email', 'kontaktweg', 'vorhaben', 'fotos']);
		expect(fehlendePflicht(STARTVORLAGE, { vorhaben: { wert: 'Bad', zeit: Z(0) }, fotos: { wert: ['a', 'b'], zeit: Z(0) } }, KUNDE_VOLL)).toEqual([]);
		expect(fortschritt(STARTVORLAGE, {}, KUNDE_VOLL)).toEqual({ erledigt: 3, gesamt: 9 });
	});
});

describe('pruefeWert', () => {
	const frage = (antwortArt: 'text' | 'janein' | 'auswahl', optionen?: string[]): Schritt => ({ id: 'f', typ: 'frage', titel: 'F', pflicht: false, antwortArt, optionen });
	it('prüft je Art', () => {
		expect(pruefeWert(frage('text'), '  Bad  ')).toBe('Bad');
		expect(pruefeWert(frage('janein'), 'ja')).toBe('ja');
		expect(() => pruefeWert(frage('janein'), 'vielleicht')).toThrow(/Ja/);
		expect(() => pruefeWert(frage('auswahl', ['a', 'b']), 'c')).toThrow(/Antworten/);
		expect(() => pruefeWert({ id: 'h', typ: 'hinweis', titel: 'H', pflicht: false }, 'x')).toThrow();
		expect(() => pruefeWert({ id: 'p', typ: 'foto', titel: 'P', pflicht: false }, ['x'])).toThrow(/Foto/);
		expect(() => pruefeWert({ id: 'a', typ: 'abhaken', titel: 'A', pflicht: false }, 'ja')).toThrow();
		expect(pruefeWert({ id: 't', typ: 'aufgabe', titel: 'T', aufgabeTitel: 'Angebot', pflicht: false }, { anlegen: true, titel: '' })).toEqual({ anlegen: true, titel: 'Angebot' });
		expect(() => pruefeWert({ id: 'k', typ: 'kundendaten', feld: 'bevorzugter_kontakt', titel: 'K', pflicht: true }, 'fax')).toThrow(/E-Mail, Chat/);
		expect(pruefeWert({ id: 'k', typ: 'kundendaten', feld: 'adresse', titel: 'K', pflicht: true }, { strasse: ' Weg 1 ', plz: '1', ort: 'Kiel', boese: 1 })).toEqual({ strasse: 'Weg 1', plz: '1', ort: 'Kiel' });
	});
});

describe('uebernimm (offline, 4b): spätere Eingabe gewinnt', () => {
	it('neue und spätere Eingaben ersetzen, ältere (verspätet angekommene) nicht', () => {
		let a = uebernimm({}, 'x', 'eins', Z(5)).antworten;
		a = uebernimm(a, 'x', 'zwei', Z(10)).antworten;
		const alt = uebernimm(a, 'x', 'alt', Z(1));
		expect(alt.geaendert).toBe(false);
		expect(alt.antworten.x.wert).toBe('zwei');
		expect(uebernimm(a, 'y', true, Z(0)).antworten).toMatchObject({ x: { wert: 'zwei' }, y: { wert: true } });
	});
});

describe('giltFuer (1c)', () => {
	const e = { aktiv: true, arten: ['besichtigung'], terminarten: ['t1'] };
	it('nur aktiv, nur mit Auftrag, Art oder Terminart angehakt', () => {
		expect(giltFuer(e, { art: 'besichtigung', terminartId: null, mitAuftrag: true })).toBe(true);
		expect(giltFuer(e, { art: 'montage', terminartId: 't1', mitAuftrag: true })).toBe(true);
		expect(giltFuer(e, { art: 'montage', terminartId: 't2', mitAuftrag: true })).toBe(false);
		expect(giltFuer({ ...e, aktiv: false }, { art: 'besichtigung', terminartId: null, mitAuftrag: true })).toBe(false);
		expect(giltFuer(e, { art: 'besichtigung', terminartId: null, mitAuftrag: false })).toBe(false);
	});
});

describe('zusammenfassung', () => {
	it('alle Schritte ohne Hinweise, mit Kundendaten aus der Akte und Begründung', () => {
		const t = zusammenfassung('Leitfaden Besichtigung', STARTVORLAGE, { vorhaben: { wert: 'Bad neu', zeit: Z(0) }, angebot: { wert: { anlegen: true, titel: 'Angebot erstellen' }, zeit: Z(0) } }, KUNDE_VOLL, 'Kunde musste weg');
		expect(t).toContain('• E-Mail-Adresse des Kunden: a@b.de');
		expect(t).toContain('• Wie möchte der Kunde am liebsten erreicht werden?: Chat');
		expect(t).toContain('• Was genau soll gemacht werden?: Bad neu');
		expect(t).toContain('angelegt: Angebot erstellen');
		expect(t).toContain('Begründung für fehlende Pflichtschritte: Kunde musste weg');
		expect(t).not.toContain('Begrüßen');
	});
});

describe('Schritt „Protokoll ausfüllen“ (Jamil msg 4353)', () => {
	const G = '11111111-1111-4111-8111-111111111111';
	const schritt: Schritt = { id: 'prot', typ: 'protokoll', titel: 'Besichtigungsprotokoll', pflicht: true, vorlageGruppe: G, vorlageName: 'Besichtigung' };
	const schema = { seiten: [{ id: 's', titel: 'S', abschnitte: [{ id: 'a', felder: [{ id: 'bereich', typ: 'text' as const, label: 'Bereich', pflicht: true }] }] }] };
	it('braucht eine Vorlage; Kennung der Vorlage wird klein geschrieben', () => {
		expect(() => pruefeSchritte([{ id: 'p', typ: 'protokoll', titel: 'P', pflicht: true }])).toThrow(/Protokoll-Vorlage/);
		expect(pruefeSchritte([{ ...schritt, vorlageGruppe: G.toUpperCase() }])[0]).toMatchObject({ vorlageGruppe: G, vorlageName: 'Besichtigung' });
	});
	it('erledigt, wenn alle Pflichtfelder des Protokolls ausgefüllt sind oder es abgeschlossen ist; ohne Protokoll nie', () => {
		const p = { id: 'x', titel: 'Besichtigung', schema, antworten: {}, status: 'entwurf' as const, pdfDateiId: null };
		expect(istErledigt(schritt, undefined, null, {})).toBe(false);
		expect(istErledigt(schritt, undefined, null, { prot: null })).toBe(false);
		expect(istErledigt(schritt, undefined, null, { prot: p })).toBe(false);
		expect(istErledigt(schritt, undefined, null, { prot: { ...p, antworten: { bereich: 'Bad' } } })).toBe(true);
		expect(istErledigt(schritt, undefined, null, { prot: { ...p, status: 'abgeschlossen' } })).toBe(true);
		expect(fehlendePflicht([schritt], {}, null, { prot: p }).map((s) => s.id)).toEqual(['prot']);
		expect(fortschritt([schritt], {}, null, { prot: { ...p, antworten: { bereich: 'Bad' } } })).toEqual({ erledigt: 1, gesamt: 1 });
	});
	it('Eingabe = Feld + Wert; ungültiger Feldname → Fehler; Zusammenfassung nennt den Stand', () => {
		expect(pruefeWert(schritt, { feld: 'bereich', wert: 'Bad' })).toEqual({ feld: 'bereich', wert: 'Bad' });
		expect(() => pruefeWert(schritt, { feld: 'böse feld', wert: 1 })).toThrow(/Feld/);
		const p = { id: 'x', titel: 'Besichtigung', schema, antworten: {}, status: 'abgeschlossen' as const, pdfDateiId: 'd' };
		expect(zusammenfassung('L', [schritt], {}, null, null, { prot: p })).toContain('„Besichtigung“ abgeschlossen (PDF bei den Dokumenten)');
	});
});
