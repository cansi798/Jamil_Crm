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

/** Leitet alle Akzent-Tokens aus einer Hausfarbe ab (ungültig/leer → Gold). */
export function farbTokens(farbe: string | null | undefined): FarbTokens {
	const hex = istFarbe(farbe) ? farbe.toLowerCase() : STANDARD_FARBE;
	const rgb = zuRgb(hex);
	const auf = kontrast(hex, DUNKEL) >= kontrast(hex, WEISS) ? DUNKEL : WEISS;
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
