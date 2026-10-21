import { inflateSync } from 'node:zlib';
import { dominanteFarbe } from '../farbe';
import { pruefeBild } from './bildpruefung';

/**
 * Akzentfarbe aus dem Logo (Wunsch Jamil, Talk msg 3016): PNG entpacken und die vorherrschende bunte Farbe suchen
 * (Weiß, Schwarz, Grau und Transparenz zählen nicht – Regeln in `dominanteFarbe`, $lib/farbe.ts).
 * Unterstützt: PNG ohne Interlace mit 8 Bit je Kanal (Graustufen, RGB, Palette, mit/ohne Alpha) – das sind praktisch
 * alle exportierten Logos. JPEG, Interlace oder 16 Bit → `null` (dann bleibt die Farbe von Hand wählbar).
 * Läuft nur auf schon mit `pruefeBild` geprüften Dateien; jeder Fehler ergibt `null`, nie eine Ausnahme.
 */
export function farbeAusLogo(b: Uint8Array): string | null {
	try {
		const info = pruefeBild(b);
		if (!info || info.typ !== 'image/png') return null;
		return dominanteFarbe(pngPixel(b));
	} catch {
		return null;
	}
}

/** Höchstens so viele Pixel ansehen (gleichmäßig verteilt) – schnell auch bei 1500 × 1500. */
const MAX_PIXEL = 60_000;

function* pngPixel(b: Uint8Array): Generator<[number, number, number, number]> {
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let i = 8;
	let breite = 0;
	let hoehe = 0;
	let tiefe = 0;
	let farbtyp = 0;
	let interlace = 0;
	let palette: Uint8Array | null = null;
	let trns: Uint8Array | null = null;
	const idat: Uint8Array[] = [];
	while (i + 12 <= b.length) {
		const laenge = v.getUint32(i);
		const typ = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
		const daten = b.subarray(i + 8, i + 8 + laenge);
		if (typ === 'IHDR') {
			breite = v.getUint32(i + 8);
			hoehe = v.getUint32(i + 12);
			tiefe = daten[8];
			farbtyp = daten[9];
			interlace = daten[12];
		} else if (typ === 'PLTE') palette = daten;
		else if (typ === 'tRNS') trns = daten;
		else if (typ === 'IDAT') idat.push(daten);
		else if (typ === 'IEND') break;
		i += 12 + laenge;
	}
	const kanaele = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[farbtyp];
	if (!kanaele || tiefe !== 8 || interlace !== 0) return;
	const roh = inflateSync(Buffer.concat(idat), { maxOutputLength: 256 * 1024 * 1024 });
	const zeile = breite * kanaele;
	let vorher = new Uint8Array(zeile);
	const schritt = Math.max(1, Math.floor(Math.sqrt((breite * hoehe) / MAX_PIXEL)));
	for (let y = 0; y < hoehe; y++) {
		const start = y * (zeile + 1);
		const filter = roh[start];
		const z = new Uint8Array(roh.subarray(start + 1, start + 1 + zeile));
		// Zeilenfilter rückgängig machen (alle Zeilen, auch die nicht angesehenen – sie sind Grundlage der nächsten)
		for (let x = 0; x < zeile; x++) {
			const a = x >= kanaele ? z[x - kanaele] : 0;
			const o = vorher[x];
			const c = x >= kanaele ? vorher[x - kanaele] : 0;
			let w = 0;
			if (filter === 1) w = a;
			else if (filter === 2) w = o;
			else if (filter === 3) w = (a + o) >> 1;
			else if (filter === 4) {
				const p = a + o - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - o);
				const pc = Math.abs(p - c);
				w = pa <= pb && pa <= pc ? a : pb <= pc ? o : c;
			}
			z[x] = (z[x] + w) & 255;
		}
		vorher = z;
		if (y % schritt !== 0) continue;
		for (let x = 0; x < breite; x += schritt) {
			const p = x * kanaele;
			if (farbtyp === 6) yield [z[p], z[p + 1], z[p + 2], z[p + 3]];
			else if (farbtyp === 2) yield [z[p], z[p + 1], z[p + 2], 255];
			else if (farbtyp === 4) yield [z[p], z[p], z[p], z[p + 1]];
			else if (farbtyp === 0) yield [z[p], z[p], z[p], 255];
			else if (palette) {
				const k = z[p];
				yield [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255];
			}
		}
	}
}
