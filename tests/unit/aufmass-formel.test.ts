import { describe, expect, it } from 'vitest';
import { alsText, ersetzeNamen, FormelFehler, namen, parse, rechne, rechneText } from '../../src/lib/aufmass-formel';

const r = rechneText;

describe('Aufmaß-Formeln (Jamil msg 2842) – Rechnen', () => {
	it('Grundrechenarten, Punkt vor Strich, Klammern, Vorzeichen', () => {
		expect(r('1 + 2 * 3', {})).toBe(7);
		expect(r('(1 + 2) * 3', {})).toBe(9);
		expect(r('10 - 4 - 3', {})).toBe(3);
		expect(r('12 / 4 / 3', {})).toBe(1);
		expect(r('-2 * -3', {})).toBe(6);
		expect(r('--2', {})).toBe(2);
		expect(r('+5', {})).toBe(5);
	});

	it('Dezimalkomma und -punkt, auch ohne führende Null', () => {
		expect(r('2,5 * 2', {})).toBe(5);
		expect(r('2.5 * 2', {})).toBe(5);
		expect(r(',5 + ,25', {})).toBe(0.75);
	});

	it('Jamils Beispiel: Wandfläche = (2*(L+B))*H − Abzug', () => {
		expect(r('(2*(L+B))*H - abzug', { L: 3, B: 2, H: 2.5, abzug: 1.6 })).toBeCloseTo(23.4, 10);
		expect(r('2 × (L + B) × H ÷ 2', { L: 3, B: 2, H: 2 })).toBe(10);
	});

	it('Funktionen: min, max, abs, runden/aufrunden/abrunden (mit Nachkommastellen), summe', () => {
		expect(r('min(3, 1, 2)', {})).toBe(1);
		expect(r('max(L, B)', { L: 3, B: 4 })).toBe(4);
		expect(r('abs(-2,5)', {})).toBe(2.5);
		expect(r('runden(2,345; 2)', {})).toBe(2.35);
		expect(r('min(1;2)', {})).toBe(1); // „;“ trennt immer
		expect(r('min(1,2)', {})).toBe(1.2); // „1,2“ ist eine Kommazahl (wie in der Tabellenkalkulation)
		expect(r('aufrunden(7,01)', {})).toBe(8);
		expect(r('aufrunden(2,0000000001)', {})).toBe(2); // Fließkomma-Rest
		expect(r('abrunden(7,99, 1)', {})).toBe(7.9);
		expect(r('aufrunden(F * 1,1 / 1,44)', { F: 12 })).toBe(10); // Fliesenpakete inkl. 10 % Verschnitt
		expect(r('summe(a, b, c)', { a: 1, b: null, c: 2 })).toBe(3);
		expect(r('summe(a, b)', { a: null, b: null })).toBeNull();
		expect(r('MIN(1, 2)', {})).toBe(1); // Funktionsnamen ohne Groß/klein
	});

	it('fehlende Werte und ÷ 0 ergeben null (nie eine falsche 0)', () => {
		expect(r('L * B', { L: 3 })).toBeNull();
		expect(r('L / (B - 2)', { L: 3, B: 2 })).toBeNull();
		expect(r('max(L, B)', { L: 3, B: null })).toBeNull();
	});
});

describe('Aufmaß-Formeln – Fehler mit klarer Meldung', () => {
	const fehler = (t: string) => {
		try {
			parse(t);
			return null;
		} catch (e) {
			expect(e).toBeInstanceOf(FormelFehler);
			return (e as Error).message;
		}
	};
	it('Syntaxfehler', () => {
		expect(fehler('')).toMatch(/leer/);
		expect(fehler('(1 + 2')).toMatch(/„\)“ fehlt/);
		expect(fehler('1 + 2)')).toMatch(/„\(“ fehlt/);
		expect(fehler('1 +')).toMatch(/zu früh/);
		expect(fehler('L B')).toMatch(/Rechenzeichen/);
		expect(fehler('2 * * 3')).toMatch(/Unerwartetes/);
		expect(fehler('1,2,3')).toMatch(/Rechenzeichen/);
	});
	it('kein Code, keine fremden Zeichen oder Funktionen', () => {
		expect(fehler('alert(1)')).toMatch(/Unbekannte Funktion/);
		expect(fehler('constructor.constructor("x")()')).toMatch(/Unerlaubtes Zeichen|Unbekannte/);
		expect(fehler('L && drop')).toMatch(/Unerlaubtes Zeichen/);
		expect(fehler('L; drop')).toMatch(/Unerwartetes|Rechenzeichen/);
		expect(fehler('2 ** 3')).toMatch(/Unerwartetes/);
		expect(fehler('L[0]')).toMatch(/Unerlaubtes Zeichen/);
		expect(fehler('`x`')).toMatch(/Unerlaubtes Zeichen/);
	});
	it('Grenzen: Länge, Bausteine, Schachtelung; Funktionsargumente', () => {
		expect(fehler('1+'.repeat(300) + '1')).toMatch(/zu lang/);
		expect(fehler('('.repeat(40) + '1' + ')'.repeat(40))).toMatch(/zu tief/);
		expect(fehler('abs(1, 2)')).toMatch(/braucht 1 Wert/);
		expect(fehler('runden(1, 9)')).toMatch(/0 bis 6/);
		expect(fehler('runden(1, L)')).toMatch(/0 bis 6/);
		expect(fehler('summe(1 + 2)')).toMatch(/Feldnamen/);
		expect(fehler('min()')).toMatch(/braucht 1 bis 20/);
	});
});

describe('Aufmaß-Formeln – Namen und Umschreiben (für Räume)', () => {
	it('namen: normale und die in summe(…) getrennt', () => {
		const k = parse('L * H + summe(wand) - abzug');
		expect(namen(k).sort()).toEqual(['H', 'L', 'abzug']);
		expect(namen(k, true)).toEqual(['wand']);
	});
	it('ersetzeNamen: Kürzel → Feld-IDs je Raum, summe → Liste; Text wieder lesbar und gleich gerechnet', () => {
		const k = ersetzeNamen(
			parse('L * B + summe(w)'),
			(n) => `${n.toLowerCase()}__2`,
			(n) => [`${n}_1`, `${n}_2`]
		);
		expect(alsText(k)).toBe('((l__2 * b__2) + summe(w_1, w_2))');
		const werte: Record<string, number> = { l__2: 2, b__2: 3, w_1: 1, w_2: 4 };
		expect(rechne(k, (n) => werte[n] ?? null)).toBe(11);
		expect(rechne(parse(alsText(k)), (n) => werte[n] ?? null)).toBe(11);
	});
});
