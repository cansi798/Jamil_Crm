import { describe, expect, it } from 'vitest';
import {
	auswerten,
	bedingungGilt,
	bereinigeAntworten,
	ersteOffeneSeite,
	fehlendeFelder,
	pruefeSchema,
	schrittFrei,
	SchemaFehler,
	wertText,
	type Feld,
	type Schema
} from '../../src/lib/protokoll-formular';
import { STARTVORLAGEN } from '../../src/lib/protokoll-startvorlagen';

const FOTO_ID = '0f6c1c1e-4b1a-4c55-9d43-0e0b1f6b8a11';
const FOTO_ID2 = '1f6c1c1e-4b1a-4c55-9d43-0e0b1f6b8a12';

/** Kleine Vorlage: Seite 1 Mangel (ja/nein) + Beschreibung (nur bei ja) + Foto (Pflicht nur bei ja); Seite 2 Unterschrift. */
const schema = (): Schema =>
	pruefeSchema({
		seiten: [
			{
				id: 's1',
				titel: 'Prüfung',
				abschnitte: [
					{
						id: 'a1',
						felder: [
							{ id: 'hinweis', typ: 'hinweis', label: 'Bitte prüfen' },
							{ id: 'mangel', typ: 'janein', label: 'Mangel', pflicht: true },
							{ id: 'text', typ: 'textlang', label: 'Beschreibung', pflicht: true, bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' } },
							{ id: 'foto', typ: 'foto', label: 'Foto des Mangels', bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'pflicht' } },
							{ id: 'feuchte', typ: 'messwert', label: 'Restfeuchte', einheit: 'CM-%', min: 0, max: 4 },
							{ id: 'trocknen', typ: 'text', label: 'Trocknungsmaßnahme', pflicht: true, bedingung: { feld: 'feuchte', op: 'groesser', wert: '2', wirkung: 'zeigen' } }
						]
					}
				]
			},
			{
				id: 's2',
				titel: 'Abschluss',
				abschnitte: [
					{
						id: 'a2',
						felder: [
							{ id: 'liste', typ: 'checkliste', label: 'Checkliste', pflicht: true, optionen: ['A', 'B'] },
							{ id: 'sig', typ: 'unterschrift', label: 'Unterschrift Kunde', pflicht: true, wer: 'kunde' }
						]
					}
				]
			}
		]
	});

describe('Protokoll-Vorlagen: Schema-Prüfung', () => {
	it('Beispielvorlagen sind gültig und unverändert nach der Prüfung', () => {
		for (const v of STARTVORLAGEN) expect(pruefeSchema(v.schema)).toEqual(v.schema);
	});

	it('doppelte IDs, unbekannte Typen, leere Optionen → SchemaFehler', () => {
		const basis = (felder: unknown[]) => ({ seiten: [{ id: 's', titel: 'x', abschnitte: [{ id: 'a', felder }] }] });
		expect(() => pruefeSchema(basis([{ id: 'x', typ: 'text', label: 'A' }, { id: 'x', typ: 'text', label: 'B' }]))).toThrow(/doppelt/);
		expect(() => pruefeSchema(basis([{ id: 'x', typ: 'rakete', label: 'A' }]))).toThrow(SchemaFehler);
		expect(() => pruefeSchema(basis([{ id: 'x', typ: 'auswahl', label: 'A', optionen: [] }]))).toThrow(/Option/);
		expect(() => pruefeSchema(basis([{ id: 'x', typ: 'text', label: '' }]))).toThrow(/Beschriftung/);
		expect(() => pruefeSchema({ seiten: [] })).toThrow(/mindestens eine Seite/);
		expect(() => pruefeSchema(basis([{ id: 'X-1', typ: 'text', label: 'A' }]))).toThrow(/ID/);
	});

	it('Bedingungen nur auf frühere Felder und mit passendem Vergleich', () => {
		const basis = (felder: unknown[]) => ({ seiten: [{ id: 's', titel: 'x', abschnitte: [{ id: 'a', felder }] }] });
		// Bezug auf ein späteres Feld (Kreis) ist verboten
		expect(() =>
			pruefeSchema(basis([{ id: 'b', typ: 'text', label: 'B', bedingung: { feld: 'a1', op: 'ausgefuellt', wirkung: 'zeigen' } }, { id: 'a1', typ: 'text', label: 'A' }]))
		).toThrow(/Feld davor/);
		// größer bei Ja/Nein passt nicht
		expect(() =>
			pruefeSchema(basis([{ id: 'a1', typ: 'janein', label: 'A' }, { id: 'b', typ: 'text', label: 'B', bedingung: { feld: 'a1', op: 'groesser', wert: '1', wirkung: 'zeigen' } }]))
		).toThrow(/passt nicht/);
		// Wert muss eine Option sein
		expect(() =>
			pruefeSchema(basis([{ id: 'a1', typ: 'auswahl', label: 'A', optionen: ['x'] }, { id: 'b', typ: 'text', label: 'B', bedingung: { feld: 'a1', op: 'gleich', wert: 'y', wirkung: 'zeigen' } }]))
		).toThrow(/keine Option/);
		// Ja/Nein nur ja/nein
		expect(() =>
			pruefeSchema(basis([{ id: 'a1', typ: 'janein', label: 'A' }, { id: 'b', typ: 'text', label: 'B', bedingung: { feld: 'a1', op: 'gleich', wert: 'vielleicht', wirkung: 'zeigen' } }]))
		).toThrow(/ja oder nein/);
	});
});

describe('Protokolle: Bedingungen auswerten', () => {
	it('„zeigen“: Beschreibung nur bei Mangel = ja; „pflicht“: Foto immer sichtbar, Pflicht nur bei ja', () => {
		const s = schema();
		let z = auswerten(s, {});
		expect(z.get('text')).toEqual({ sichtbar: false, pflicht: false });
		expect(z.get('foto')).toEqual({ sichtbar: true, pflicht: false });
		z = auswerten(s, { mangel: false });
		expect(z.get('text')?.sichtbar).toBe(false);
		expect(z.get('foto')?.pflicht).toBe(false);
		z = auswerten(s, { mangel: true });
		expect(z.get('text')).toEqual({ sichtbar: true, pflicht: true });
		expect(z.get('foto')).toEqual({ sichtbar: true, pflicht: true });
		expect(z.get('hinweis')).toEqual({ sichtbar: true, pflicht: false });
	});

	it('Zahlenvergleich (größer als) und Kaskade über verborgene Felder', () => {
		const s = pruefeSchema({
			seiten: [
				{
					id: 's',
					titel: 'x',
					abschnitte: [
						{
							id: 'a',
							felder: [
								{ id: 'art', typ: 'auswahl', label: 'Art', optionen: ['Bad', 'Küche'] },
								{ id: 'wanne', typ: 'janein', label: 'Wanne?', bedingung: { feld: 'art', op: 'gleich', wert: 'Bad', wirkung: 'zeigen' } },
								{ id: 'masse', typ: 'zahl', label: 'Länge', bedingung: { feld: 'wanne', op: 'gleich', wert: 'ja', wirkung: 'zeigen' } }
							]
						}
					]
				}
			]
		});
		expect(auswerten(s, { art: 'Bad', wanne: true }).get('masse')?.sichtbar).toBe(true);
		// Art wechselt auf Küche: „Wanne?“ verborgen → sein (alter) Wert zählt nicht mehr → Länge auch verborgen
		expect(auswerten(s, { art: 'Küche', wanne: true }).get('masse')?.sichtbar).toBe(false);
		const zahl = schema();
		expect(auswerten(zahl, { feuchte: 2.5 }).get('trocknen')?.sichtbar).toBe(true);
		expect(auswerten(zahl, { feuchte: 2 }).get('trocknen')?.sichtbar).toBe(false);
	});

	it('bedingungGilt: gleich/ungleich/ausgefüllt/leer, Mehrfachauswahl enthält, Groß-/Kleinschreibung egal', () => {
		const text: Feld = { id: 't', typ: 'text', label: 'T' };
		const mehr: Feld = { id: 'm', typ: 'mehrfach', label: 'M', optionen: ['a', 'b'] };
		expect(bedingungGilt({ feld: 't', op: 'gleich', wert: 'Ok', wirkung: 'zeigen' }, text, ' ok ')).toBe(true);
		expect(bedingungGilt({ feld: 't', op: 'ungleich', wert: 'ok', wirkung: 'zeigen' }, text, 'nein')).toBe(true);
		// leer ist weder gleich noch ungleich
		expect(bedingungGilt({ feld: 't', op: 'ungleich', wert: 'ok', wirkung: 'zeigen' }, text, '')).toBe(false);
		expect(bedingungGilt({ feld: 't', op: 'ausgefuellt', wirkung: 'zeigen' }, text, 'x')).toBe(true);
		expect(bedingungGilt({ feld: 't', op: 'leer', wirkung: 'zeigen' }, text, undefined)).toBe(true);
		expect(bedingungGilt({ feld: 'm', op: 'gleich', wert: 'b', wirkung: 'zeigen' }, mehr, ['a', 'b'])).toBe(true);
		expect(bedingungGilt({ feld: 'm', op: 'gleich', wert: 'b', wirkung: 'zeigen' }, mehr, ['a'])).toBe(false);
	});
});

describe('Protokolle: Pflichtfelder sperren „Weiter“', () => {
	it('Schritt 1 ohne Antwort gesperrt; mit „nein“ frei; mit „ja“ braucht es Beschreibung UND Foto', () => {
		const s = schema();
		expect(schrittFrei(s, {}, 0)).toBe(false);
		expect(fehlendeFelder(s, {}, 0).map((f) => f.feldId)).toEqual(['mangel']);
		expect(schrittFrei(s, { mangel: false }, 0)).toBe(true);
		expect(fehlendeFelder(s, { mangel: true }, 0).map((f) => [f.feldId, f.grund])).toEqual([
			['text', 'Pflichtfeld'],
			['foto', 'Foto fehlt']
		]);
		expect(schrittFrei(s, { mangel: true, text: 'Riss', foto: [FOTO_ID] }, 0)).toBe(true);
	});

	it('Mindestanzahl Fotos, Checkliste vollständig, Unterschrift vorhanden, Messwert in Grenzen', () => {
		const s = pruefeSchema({
			seiten: [{ id: 's', titel: 'x', abschnitte: [{ id: 'a', felder: [{ id: 'f', typ: 'foto', label: 'Fotos', pflicht: true, minFotos: 2 }] }] }]
		});
		expect(fehlendeFelder(s, { f: [FOTO_ID] })[0].grund).toBe('noch 1 Foto');
		expect(schrittFrei(s, { f: [FOTO_ID, FOTO_ID2] }, 0)).toBe(true);

		const t = schema();
		const fertig1 = { mangel: false };
		expect(fehlendeFelder(t, { ...fertig1, liste: ['A'] }, 1).map((f) => f.grund)).toEqual(['1 Punkt offen', 'Unterschrift fehlt']);
		expect(schrittFrei(t, { ...fertig1, liste: ['A', 'B'], sig: { dateiId: FOTO_ID, name: 'Frau Müller' } }, 1)).toBe(true);
		// Messwert außerhalb der Grenzen sperrt auch ohne Pflicht
		expect(fehlendeFelder(t, { mangel: false, feuchte: 7 }, 0).map((f) => f.grund)).toEqual(['höchstens 4 CM-%', 'Pflichtfeld']);
	});

	it('ersteOffeneSeite und Abdichtungsprotokoll: ohne Foto der Abdichtung geht es nicht weiter', () => {
		const abd = STARTVORLAGEN.find((v) => v.schluessel === 'abdichtung-bad')!.schema;
		const fotoSeite = abd.seiten.findIndex((s) => s.id === 's_fotos');
		expect(schrittFrei(abd, {}, fotoSeite)).toBe(false);
		expect(fehlendeFelder(abd, {}, fotoSeite)).toEqual([{ feldId: 'foto_abdichtung', label: 'Foto der Abdichtung', grund: 'Foto fehlt', seite: fotoSeite }]);
		expect(schrittFrei(abd, { foto_abdichtung: [FOTO_ID] }, fotoSeite)).toBe(true);
		expect(ersteOffeneSeite(abd, {})).toBe(0);
	});
});

describe('Protokolle: Antworten bereinigen und anzeigen', () => {
	it('nur bekannte Felder, passende Typen; Fotos/Unterschrift nur vom Server', () => {
		const s = schema();
		const roh = {
			mangel: 'ja', // kein Boolean → fällt weg
			text: 'Riss\u0000',
			foto: ['fremd'], // Dateien setzt nur der Server
			feuchte: '3,5',
			liste: ['B', 'X', 'A'],
			unbekannt: 'x',
			sig: { dateiId: FOTO_ID }
		};
		expect(bereinigeAntworten(s, roh, { foto: [FOTO_ID2] })).toEqual({ text: 'Riss', foto: [FOTO_ID2], feuchte: 3.5, liste: ['A', 'B'] });
		expect(bereinigeAntworten(s, null)).toEqual({});
	});

	it('wertText', () => {
		const s = schema();
		const f = (id: string) => s.seiten.flatMap((x) => x.abschnitte.flatMap((a) => a.felder)).find((x) => x.id === id)!;
		expect(wertText(f('mangel'), true)).toBe('Ja');
		expect(wertText(f('feuchte'), 2.5)).toBe('2,5 CM-%');
		expect(wertText(f('liste'), ['A'])).toBe('☑ A\n☐ B');
		expect(wertText(f('text'), undefined)).toBe('–');
		expect(wertText(f('sig'), { dateiId: FOTO_ID, name: 'Frau Müller' })).toBe('unterschrieben von Frau Müller');
	});
});
