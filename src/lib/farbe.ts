/**
 * Hausfarbe eines Betriebs → Farb-Tokens der Oberfläche (Theme „Handwerk“, Gold als Standard).
 * Aus einer Farbe (#rrggbb) entstehen: Füllung (Knöpfe, aktive Reiter), Text darauf (dunkel oder weiß, je nach
 * Kontrast), eine dunklere Textfarbe für Links/Akzenttext auf Weiß (Kontrast ≥ 4,6 : 1) und zarte Tönungen.
 * Rein rechnerisch, ohne Serverbezug – Tests: tests/unit/farbe.test.ts.
 */

export const STANDARD_FARBE = '#c3a56f'; // Gold aus dem Bauwelt-Handwerk-CI

type Rgb = [number, number, number];

export function istFarbe(w: unknown): w is string {
	return typeof w === 'string' && /^#[0-9a-f]{6}$/i.test(w);
}

function zuRgb(hex: string): Rgb {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function zuHex([r, g, b]: Rgb): string {
	return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function mische(a: Rgb, b: Rgb, anteilB: number): Rgb {
	return [0, 1, 2].map((i) => a[i] * (1 - anteilB) + b[i] * anteilB) as Rgb;
}
/** Relative Helligkeit nach WCAG 2.x */
export function helligkeit(hex: string): number {
	const kanal = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = zuRgb(hex);
	return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
}
export function kontrast(a: string, b: string): number {
	const [x, y] = [helligkeit(a), helligkeit(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}

const DUNKEL = '#1f1e20';
const WEISS = '#ffffff';
const SCHWARZ: Rgb = [0, 0, 0];
const WEISS_RGB: Rgb = [255, 255, 255];

export type FarbTokens = {
	'--ui-akzent': string;
	'--ui-akzent-hover': string;
	'--ui-akzent-auf': string;
	'--ui-akzent-text': string;
	'--ui-akzent-hell': string;
	'--ui-akzent-zart': string;
	'--ui-akzent-rand': string;
	'--ui-fokus-ring': string;
};

/**
 * Füllfarbe lesbar machen (msg 3016): Text auf der Füllung (dunkel oder weiß, das Bessere) muss WCAG AA erreichen
 * (≥ 4,5 : 1). Reicht keines von beiden, wird die Füllung schrittweise abgedunkelt, bis weißer Text 4,5 : 1 hat.
 */
export function lesbareFuellung(hex: string): { fuellung: string; auf: string } {
	const besser = (f: string) => (kontrast(f, DUNKEL) >= kontrast(f, WEISS) ? DUNKEL : WEISS);
	if (kontrast(hex, besser(hex)) >= 4.5) return { fuellung: hex, auf: besser(hex) };
	const rgb = zuRgb(hex);
	for (let i = 1; i <= 20; i++) {
		const f = zuHex(mische(rgb, SCHWARZ, i * 0.05));
		if (kontrast(f, WEISS) >= 4.5) return { fuellung: f, auf: WEISS };
	}
	return { fuellung: DUNKEL, auf: WEISS };
}

/**
 * Vorherrschende bunte Farbe aus Pixeln [r, g, b, a] (Logo, msg 3016). Nicht gezählt: (fast) durchsichtig,
 * fast Weiß/Schwarz und Grautöne (Sättigung < 25 %). Die Pixel kommen in Farbtöpfe (je Kanal 16 Stufen); der größte
 * Topf gewinnt, Ergebnis ist sein Mittelwert. Weniger als 0,5 % bunte Pixel (bzw. < 20) → `null` (keine brauchbare Farbe).
 */
export function dominanteFarbe(pixel: Iterable<readonly [number, number, number, number]>): string | null {
	const toepfe = new Map<number, { n: number; r: number; g: number; b: number }>();
	let alle = 0;
	let bunt = 0;
	for (const [r, g, b, a] of pixel) {
		if (a < 128) continue;
		alle++;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 510;
		if (l < 0.1 || l > 0.94) continue;
		const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
		if (s < 0.25) continue;
		bunt++;
		const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
		const t = toepfe.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
		t.n++;
		t.r += r;
		t.g += g;
		t.b += b;
		toepfe.set(k, t);
	}
	if (bunt < 20 || bunt < alle * 0.005) return null;
	let best: { n: number; r: number; g: number; b: number } | null = null;
	for (const t of toepfe.values()) if (!best || t.n > best.n) best = t;
	return best ? zuHex([best.r / best.n, best.g / best.n, best.b / best.n]) : null;
}

/** Leitet alle Akzent-Tokens aus einer Hausfarbe ab (ungültig/leer → Gold). */
export function farbTokens(farbe: string | null | undefined): FarbTokens {
	const { fuellung: hex, auf } = lesbareFuellung(istFarbe(farbe) ? farbe.toLowerCase() : STANDARD_FARBE);
	const rgb = zuRgb(hex);
	// Textfarbe auf Weiß: so lange abdunkeln, bis der Kontrast reicht
	let text = hex;
	for (let i = 1; i <= 20 && kontrast(text, WEISS) < 4.6; i++) text = zuHex(mische(rgb, SCHWARZ, i * 0.05));
	const hover = zuHex(mische(rgb, SCHWARZ, 0.1));
	const [r, g, b] = rgb;
	return {
		'--ui-akzent': hex,
		'--ui-akzent-hover': hover,
		'--ui-akzent-auf': auf,
		'--ui-akzent-text': text,
		'--ui-akzent-hell': zuHex(mische(rgb, WEISS_RGB, 0.84)),
		'--ui-akzent-zart': zuHex(mische(rgb, WEISS_RGB, 0.93)),
		'--ui-akzent-rand': zuHex(mische(rgb, WEISS_RGB, 0.55)),
		'--ui-fokus-ring': `0 0 0 3px rgba(${r}, ${g}, ${b}, 0.35)`
	};
}

/** Tokens als Inline-Stil (`style="…"`) für die App-Hülle. */
export function farbStil(farbe: string | null | undefined): string {
	return Object.entries(farbTokens(farbe))
		.map(([k, v]) => `${k}: ${v}`)
		.join('; ');
}
