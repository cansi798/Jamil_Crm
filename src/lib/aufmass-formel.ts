/**
 * Formeln für Aufmaß-Vorlagen (Wunsch Jamil, Talk msg 2842) – z. B. `wand = (2*(L+B))*H - abzug`.
 *
 * Eigener kleiner Parser (rekursiver Abstieg), KEIN eval: Zahlen (Komma oder Punkt), Namen (Kürzel bzw. Feld-IDs),
 * + − * /, Klammern, Vorzeichen und die Funktionen (Werte getrennt mit „;“ oder „, “ – „1,5“ ist eine Kommazahl) min, max, abs, runden(x[, n]), aufrunden(x[, n]), abrunden(x[, n])
 * sowie summe(Name) – die Summe eines Felds über alle Wiederholungen (z. B. alle Räume).
 * Grenzen: 500 Zeichen, 200 Bausteine, Schachtelung 30. Fehlende Werte ergeben null (keine falsche 0), ebenso ÷ 0.
 */

export type Knoten =
	| { t: 'zahl'; w: number }
	| { t: 'name'; n: string }
	| { t: 'neg'; a: Knoten }
	| { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Knoten; b: Knoten }
	| { t: 'fn'; n: Funktion; args: Knoten[] };

export const FUNKTIONEN = ['min', 'max', 'abs', 'runden', 'aufrunden', 'abrunden', 'summe'] as const;
export type Funktion = (typeof FUNKTIONEN)[number];

export class FormelFehler extends Error {
	constructor(meldung: string) {
		super(meldung);
		this.name = 'FormelFehler';
	}
}

export const FORMEL_GRENZEN = { zeichen: 500, bausteine: 200, tiefe: 30 } as const;

type Token = { t: 'zahl'; w: number } | { t: 'name'; n: string } | { t: 'op'; o: string };

const NAME_START = /[A-Za-zÄÖÜäöüß_]/;
const NAME_ZEICHEN = /[A-Za-z0-9ÄÖÜäöüß_]/;

function zerlege(text: string): Token[] {
	if (text.length > FORMEL_GRENZEN.zeichen) throw new FormelFehler(`Die Formel ist zu lang (höchstens ${FORMEL_GRENZEN.zeichen} Zeichen).`);
	const aus: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === ' ' || c === '\t' || c === '\n') {
			i++;
			continue;
		}
		if (/[0-9]/.test(c) || ((c === ',' || c === '.') && /[0-9]/.test(text[i + 1] ?? ''))) {
			let j = i;
			let trenner = false;
			while (j < text.length && (/[0-9]/.test(text[j]) || ((text[j] === ',' || text[j] === '.') && !trenner && /[0-9]/.test(text[j + 1] ?? '')))) {
				if (text[j] === ',' || text[j] === '.') trenner = true;
				j++;
			}
			const w = Number(text.slice(i, j).replace(',', '.'));
			if (!Number.isFinite(w)) throw new FormelFehler(`Ungültige Zahl „${text.slice(i, j)}“.`);
			aus.push({ t: 'zahl', w });
			i = j;
		} else if (NAME_START.test(c)) {
			let j = i + 1;
			while (j < text.length && NAME_ZEICHEN.test(text[j])) j++;
			aus.push({ t: 'name', n: text.slice(i, j) });
			i = j;
		} else if ('+-*/(),;×÷'.includes(c)) {
			aus.push({ t: 'op', o: c === '×' ? '*' : c === '÷' ? '/' : c === ';' ? ',' : c });
			i++;
		} else {
			throw new FormelFehler(`Unerlaubtes Zeichen „${c}“ in der Formel.`);
		}
		if (aus.length > FORMEL_GRENZEN.bausteine) throw new FormelFehler('Die Formel ist zu lang.');
	}
	return aus;
}

/** Formel → Baum. Wirft `FormelFehler` mit deutscher Meldung. */
export function parse(text: string): Knoten {
	const tokens = zerlege(text);
	if (tokens.length === 0) throw new FormelFehler('Die Formel ist leer.');
	let pos = 0;
	const sieh = () => tokens[pos];
	const istOp = (o: string) => {
		const t = tokens[pos];
		return t?.t === 'op' && t.o === o;
	};
	const erwarte = (o: string) => {
		if (!istOp(o)) throw new FormelFehler(o === ')' ? 'Eine Klammer „)“ fehlt.' : `„${o}“ erwartet.`);
		pos++;
	};

	function ausdruck(tiefe: number): Knoten {
		if (tiefe > FORMEL_GRENZEN.tiefe) throw new FormelFehler('Die Formel ist zu tief geschachtelt.');
		let a = term(tiefe + 1);
		while (istOp('+') || istOp('-')) {
			const op = (tokens[pos++] as { o: '+' | '-' }).o;
			a = { t: 'bin', op, a, b: term(tiefe + 1) };
		}
		return a;
	}
	function term(tiefe: number): Knoten {
		let a = faktor(tiefe + 1);
		while (istOp('*') || istOp('/')) {
			const op = (tokens[pos++] as { o: '*' | '/' }).o;
			a = { t: 'bin', op, a, b: faktor(tiefe + 1) };
		}
		return a;
	}
	function faktor(tiefe: number): Knoten {
		if (tiefe > FORMEL_GRENZEN.tiefe) throw new FormelFehler('Die Formel ist zu tief geschachtelt.');
		if (istOp('-')) {
			pos++;
			return { t: 'neg', a: faktor(tiefe + 1) };
		}
		if (istOp('+')) {
			pos++;
			return faktor(tiefe + 1);
		}
		const t = sieh();
		if (!t) throw new FormelFehler('Die Formel endet zu früh.');
		if (t.t === 'zahl') {
			pos++;
			return { t: 'zahl', w: t.w };
		}
		if (t.t === 'name') {
			pos++;
			if (istOp('(')) {
				const n = t.n.toLowerCase();
				if (!(FUNKTIONEN as readonly string[]).includes(n)) throw new FormelFehler(`Unbekannte Funktion „${t.n}“.`);
				pos++;
				const args: Knoten[] = [];
				if (!istOp(')')) {
					args.push(ausdruck(tiefe + 1));
					while (istOp(',')) {
						pos++;
						args.push(ausdruck(tiefe + 1));
					}
				}
				erwarte(')');
				return pruefeFunktion(n as Funktion, args);
			}
			return { t: 'name', n: t.n };
		}
		if (istOp('(')) {
			pos++;
			const a = ausdruck(tiefe + 1);
			erwarte(')');
			return a;
		}
		throw new FormelFehler(`Unerwartetes „${(t as { o: string }).o}“ in der Formel.`);
	}

	const baum = ausdruck(0);
	if (pos < tokens.length) {
		const t = tokens[pos];
		throw new FormelFehler(t.t === 'op' && t.o === ')' ? 'Eine Klammer „(“ fehlt.' : 'Zwischen zwei Werten fehlt ein Rechenzeichen.');
	}
	return baum;
}

function pruefeFunktion(n: Funktion, args: Knoten[]): Knoten {
	const anzahl = (min: number, max: number) => {
		if (args.length < min || args.length > max) throw new FormelFehler(`${n}(…) braucht ${min === max ? min : `${min} bis ${max}`} Wert${max === 1 ? '' : 'e'}.`);
	};
	if (n === 'min' || n === 'max') anzahl(1, 20);
	else if (n === 'abs') anzahl(1, 1);
	else if (n === 'runden' || n === 'aufrunden' || n === 'abrunden') {
		anzahl(1, 2);
		if (args[1] && (args[1].t !== 'zahl' || !Number.isInteger(args[1].w) || args[1].w < 0 || args[1].w > 6)) {
			throw new FormelFehler(`${n}(x, n): n muss eine ganze Zahl von 0 bis 6 sein.`);
		}
	} else if (n === 'summe') {
		if (args.length < 1 || args.some((a) => a.t !== 'name')) throw new FormelFehler('summe(…) erwartet Feldnamen, z. B. summe(wand).');
	}
	return { t: 'fn', n, args };
}

/** Alle Namen im Baum; `inSumme`: nur die in summe(…). */
export function namen(k: Knoten, inSumme = false): string[] {
	const aus = new Set<string>();
	const lauf = (x: Knoten, summe: boolean) => {
		if (x.t === 'name') {
			if (summe === inSumme) aus.add(x.n);
		} else if (x.t === 'neg') lauf(x.a, summe);
		else if (x.t === 'bin') {
			lauf(x.a, summe);
			lauf(x.b, summe);
		} else if (x.t === 'fn') for (const a of x.args) lauf(a, summe || x.n === 'summe');
	};
	lauf(k, false);
	return [...aus];
}

/** Namen ersetzen (z. B. Kürzel → Feld-ID je Raum); `summe` bekommt eine Liste von Namen. */
export function ersetzeNamen(k: Knoten, einzeln: (n: string) => string, liste: (n: string) => string[]): Knoten {
	switch (k.t) {
		case 'zahl':
			return k;
		case 'name':
			return { t: 'name', n: einzeln(k.n) };
		case 'neg':
			return { t: 'neg', a: ersetzeNamen(k.a, einzeln, liste) };
		case 'bin':
			return { t: 'bin', op: k.op, a: ersetzeNamen(k.a, einzeln, liste), b: ersetzeNamen(k.b, einzeln, liste) };
		case 'fn':
			return k.n === 'summe'
				? { t: 'fn', n: 'summe', args: k.args.flatMap((a) => (a.t === 'name' ? liste(a.n).map((n) => ({ t: 'name' as const, n })) : [])) }
				: { t: 'fn', n: k.n, args: k.args.map((a) => ersetzeNamen(a, einzeln, liste)) };
	}
}

/** Baum → Formeltext (für gespeicherte, aufgelöste Formeln). */
export function alsText(k: Knoten): string {
	switch (k.t) {
		case 'zahl':
			return String(k.w);
		case 'name':
			return k.n;
		case 'neg':
			return `-(${alsText(k.a)})`;
		case 'bin':
			return `(${alsText(k.a)} ${k.op} ${alsText(k.b)})`;
		case 'fn':
			return `${k.n}(${k.args.map(alsText).join(', ')})`;
	}
}

const rundeAuf = (x: number, n: number, art: 'runden' | 'aufrunden' | 'abrunden') => {
	const f = 10 ** n;
	// kleine Fließkomma-Reste nicht aufrunden (z. B. 2,0000000001 → 2)
	const y = Math.round(x * f * 1e6) / 1e6;
	return (art === 'runden' ? Math.round(y) : art === 'aufrunden' ? Math.ceil(y) : Math.floor(y)) / f;
};

/**
 * Wert der Formel; `wert(name)` liefert Zahl oder null. null, sobald ein gebrauchter Wert fehlt oder durch 0 geteilt
 * wird – außer in summe(…): Dort zählen nur vorhandene Werte (keine → null).
 */
export function rechne(k: Knoten, wert: (name: string) => number | null): number | null {
	switch (k.t) {
		case 'zahl':
			return k.w;
		case 'name': {
			const w = wert(k.n);
			return w === null || !Number.isFinite(w) ? null : w;
		}
		case 'neg': {
			const a = rechne(k.a, wert);
			return a === null ? null : -a;
		}
		case 'bin': {
			const a = rechne(k.a, wert);
			const b = rechne(k.b, wert);
			if (a === null || b === null) return null;
			if (k.op === '/') return b === 0 ? null : a / b;
			return k.op === '+' ? a + b : k.op === '-' ? a - b : a * b;
		}
		case 'fn': {
			if (k.n === 'summe') {
				const w = k.args.map((a) => rechne(a, wert)).filter((x): x is number => x !== null);
				return w.length ? w.reduce((s, x) => s + x, 0) : null;
			}
			const w = k.args.map((a) => rechne(a, wert));
			if (w.some((x) => x === null)) return null;
			const z = w as number[];
			switch (k.n) {
				case 'min':
					return Math.min(...z);
				case 'max':
					return Math.max(...z);
				case 'abs':
					return Math.abs(z[0]);
				default:
					return rundeAuf(z[0], z[1] ?? 0, k.n);
			}
		}
	}
}

/** Bequem: Text → Wert (für Tests und die Vorschau im Baukasten). */
export function rechneText(text: string, werte: Record<string, number | null>): number | null {
	return rechne(parse(text), (n) => werte[n] ?? werte[n.toLowerCase()] ?? null);
}
