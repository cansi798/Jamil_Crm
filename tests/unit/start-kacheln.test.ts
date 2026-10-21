import { describe, expect, it } from 'vitest';
import { bereinigeLayout, KACHEL_ARTEN, LayoutFehler, MAX_KACHELN, pruefeLayout, standardLayout, verschiebe, zieheAuf } from '../../src/lib/start-kacheln';

/** Frei zusammenstellbarer Start (Jamil msg 2942): Prüfen, Bereinigen, Vorgaben, Verschieben. */
const ALLE = new Set(KACHEL_ARTEN.map((a) => a.id));
const NUR_MONTEUR = new Set(['heute', 'zeiterfassung', 'bereiche']);

describe('Start-Kacheln', () => {
	it('pruefeLayout: gültiges Layout bleibt, Reihenfolge zählt', () => {
		const l = [
			{ id: 'heute', groesse: 'l', hoehe: 2 },
			{ id: 'kz-abschlussquote', groesse: 's', hoehe: 1 }
		];
		expect(pruefeLayout(l, ALLE)).toEqual(l);
		expect(pruefeLayout([], ALLE)).toEqual([]);
	});

	it('pruefeLayout: lehnt Unbekanntes, Verbotenes, Doppeltes und kaputte Werte ab', () => {
		const f = (roh: unknown, erlaubt = ALLE) => () => pruefeLayout(roh, erlaubt);
		expect(f(null)).toThrow(LayoutFehler);
		expect(f({ id: 'heute' })).toThrow(LayoutFehler);
		expect(f([{ id: 'gibts-nicht', groesse: 's', hoehe: 1 }])).toThrow(/Unbekannte/);
		expect(f([{ id: 'quellen', groesse: 'l', hoehe: 1 }], NUR_MONTEUR)).toThrow(/nicht zur Verfügung/);
		expect(f([{ id: 'heute', groesse: 'l', hoehe: 1 }, { id: 'heute', groesse: 's', hoehe: 1 }])).toThrow(/doppelt/);
		expect(f([{ id: 'heute', groesse: 'xl', hoehe: 1 }])).toThrow(/Größe/);
		expect(f([{ id: 'heute', groesse: 'l', hoehe: 3 }])).toThrow(/Höhe/);
		expect(f([{ id: 'heute', groesse: 'l', hoehe: '2' }])).toThrow(/Höhe/);
		expect(f(Array.from({ length: MAX_KACHELN + 1 }, () => ({ id: 'heute', groesse: 's', hoehe: 1 })))).toThrow(/Höchstens/);
	});

	it('bereinigeLayout: nicht mehr erlaubte/unbekannte Kacheln fallen still weg, kaputte Größen → Vorgabe', () => {
		const roh = [
			{ id: 'quellen', groesse: 'l', hoehe: 1 },
			{ id: 'heute', groesse: 'riesig', hoehe: 7 },
			{ id: 'heute', groesse: 's', hoehe: 1 },
			{ id: 'weg', groesse: 's', hoehe: 1 },
			'quatsch'
		];
		expect(bereinigeLayout(roh, NUR_MONTEUR)).toEqual([{ id: 'heute', groesse: 'l', hoehe: 2 }]);
		expect(bereinigeLayout('kein Array', ALLE)).toEqual([]);
	});

	it('Vorgaben je Rolle nur mit erlaubten Kacheln', () => {
		const monteur = standardLayout('monteur', NUR_MONTEUR);
		expect(monteur.map((e) => e.id)).toEqual(['zeiterfassung', 'heute', 'bereiche']);
		expect(standardLayout('chef', ALLE).length).toBeGreaterThan(8);
		expect(standardLayout('chef', NUR_MONTEUR).every((e) => NUR_MONTEUR.has(e.id))).toBe(true);
		// Vorgaben bestehen die strenge Prüfung
		for (const r of ['chef', 'buero', 'monteur'] as const) expect(() => pruefeLayout(standardLayout(r, ALLE), ALLE)).not.toThrow();
	});

	it('verschiebe und zieheAuf', () => {
		const l = ['a', 'b', 'c'].map((id) => ({ id, groesse: 's' as const, hoehe: 1 as const }));
		expect(verschiebe(l, 0, 1).map((e) => e.id)).toEqual(['b', 'a', 'c']);
		expect(verschiebe(l, 0, -1)).toBe(l);
		expect(verschiebe(l, 2, 1)).toBe(l);
		expect(zieheAuf(l, 'c', 'a').map((e) => e.id)).toEqual(['c', 'a', 'b']);
		expect(zieheAuf(l, 'a', 'c').map((e) => e.id)).toEqual(['b', 'c', 'a']);
		expect(zieheAuf(l, 'x', 'a')).toBe(l);
	});
});
