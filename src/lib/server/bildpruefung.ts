import { inflateSync } from 'node:zlib';

/**
 * Vollständige, synchrone Prüfung eines Logos (PNG oder JPEG) – nicht nur der Kopf. Hintergrund: pdfkit dekodiert
 * PNGs mit Transparenz, Palette oder Interlace später in einem zlib-Rückruf; kaputte Bilddaten werfen dort außerhalb
 * jedes try/catch und beenden den ganzen Server. Deshalb wird hier alles geprüft, was pdfkit später braucht:
 *
 * - PNG: Signatur, Blöcke mit Längen und CRC, IHDR (Maße, Farbtyp/Bit-Tiefe), PLTE bei Palette, alle IDAT-Daten
 *   lassen sich entpacken (inflate) und sind lang genug (auch bei Interlace/Adam7), jedes Zeilen-Filterbyte ist 0–4,
 *   IEND am Ende.
 * - JPEG: SOI, Segmente mit gültigen Längen, ein SOF mit Maßen vor dem SOS, danach Bilddaten und EOI.
 */

export type BildInfo = { typ: 'image/png' | 'image/jpeg'; breite: number; hoehe: number };

const PNG_SIGNATUR = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABELLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(b: Uint8Array): number {
	let c = 0xffffffff;
	for (const x of b) c = CRC_TABELLE[(c ^ x) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** Kanäle je Farbtyp und erlaubte Bit-Tiefen (PNG-Spezifikation). */
const FARBTYPEN: Record<number, { kanaele: number; tiefen: number[] }> = {
	0: { kanaele: 1, tiefen: [1, 2, 4, 8, 16] },
	2: { kanaele: 3, tiefen: [8, 16] },
	3: { kanaele: 1, tiefen: [1, 2, 4, 8] },
	4: { kanaele: 2, tiefen: [8, 16] },
	6: { kanaele: 4, tiefen: [8, 16] }
};

// Adam7: [x-Start, y-Start, x-Schritt, y-Schritt]
const ADAM7 = [
	[0, 0, 8, 8],
	[4, 0, 8, 8],
	[0, 4, 4, 8],
	[2, 0, 4, 4],
	[0, 2, 2, 4],
	[1, 0, 2, 2],
	[0, 1, 1, 2]
];

function pruefePng(b: Uint8Array): BildInfo | null {
	if (b.length < 8 || !PNG_SIGNATUR.every((x, i) => b[i] === x)) return null;
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let i = 8;
	let ihdr: { breite: number; hoehe: number; tiefe: number; farbtyp: number; interlace: number } | null = null;
	let plte = false;
	let iend = false;
	const idat: Uint8Array[] = [];
	while (i + 12 <= b.length) {
		const laenge = v.getUint32(i);
		const typ = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
		if (i + 12 + laenge > b.length) return null;
		const daten = b.subarray(i + 8, i + 8 + laenge);
		if (crc32(b.subarray(i + 4, i + 8 + laenge)) !== v.getUint32(i + 8 + laenge)) return null;
		if (ihdr === null && typ !== 'IHDR') return null;
		if (typ === 'IHDR') {
			if (ihdr !== null || laenge !== 13) return null;
			const d = new DataView(daten.buffer, daten.byteOffset, 13);
			ihdr = { breite: d.getUint32(0), hoehe: d.getUint32(4), tiefe: daten[8], farbtyp: daten[9], interlace: daten[12] };
			if (daten[10] !== 0 || daten[11] !== 0 || ihdr.interlace > 1) return null;
		} else if (typ === 'PLTE') {
			plte = true;
		} else if (typ === 'IDAT') {
			idat.push(daten);
		} else if (typ === 'IEND') {
			iend = true;
			break;
		}
		i += 12 + laenge;
	}
	if (!ihdr || !iend || idat.length === 0) return null;
	const farbe = FARBTYPEN[ihdr.farbtyp];
	if (!farbe || !farbe.tiefen.includes(ihdr.tiefe)) return null;
	if (ihdr.farbtyp === 3 && !plte) return null;
	if (ihdr.breite < 1 || ihdr.hoehe < 1 || ihdr.breite > 20000 || ihdr.hoehe > 20000) return null;

	let roh: Buffer;
	try {
		roh = inflateSync(Buffer.concat(idat), { maxOutputLength: 256 * 1024 * 1024 });
	} catch {
		return null;
	}
	const bitsJePixel = farbe.kanaele * ihdr.tiefe;
	const durchgaenge =
		ihdr.interlace === 1
			? ADAM7.map(([x0, y0, dx, dy]) => [Math.ceil((ihdr!.breite - x0) / dx), Math.ceil((ihdr!.hoehe - y0) / dy)])
			: [[ihdr.breite, ihdr.hoehe]];
	let pos = 0;
	for (const [w, h] of durchgaenge) {
		if (w <= 0 || h <= 0) continue;
		const zeile = Math.ceil((w * bitsJePixel) / 8);
		for (let y = 0; y < h; y++) {
			if (pos >= roh.length || roh[pos] > 4) return null; // Filterbyte fehlt oder unbekannt
			pos += 1 + zeile;
		}
	}
	if (pos > roh.length) return null;
	return { typ: 'image/png', breite: ihdr.breite, hoehe: ihdr.hoehe };
}

function pruefeJpeg(b: Uint8Array): BildInfo | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	let i = 2;
	let masse: { breite: number; hoehe: number } | null = null;
	while (i + 4 <= b.length) {
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1];
		if (marker === 0xff) {
			i++;
			continue;
		}
		if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			i += 2;
			continue;
		}
		if (marker === 0xd8 || marker === 0xd9) return null; // zweites SOI bzw. Ende vor den Bilddaten
		const laenge = (b[i + 2] << 8) | b[i + 3];
		if (laenge < 2 || i + 2 + laenge > b.length) return null;
		const istSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (istSof) {
			if (laenge < 8) return null;
			masse = { hoehe: (b[i + 5] << 8) | b[i + 6], breite: (b[i + 7] << 8) | b[i + 8] };
		}
		if (marker === 0xda) {
			// Start of Scan: vorher muss ein SOF stehen; danach Bilddaten und am Ende EOI
			if (!masse || masse.breite < 1 || masse.hoehe < 1) return null;
			const daten = i + 2 + laenge;
			let ende = b.length;
			while (ende > daten && b[ende - 1] === 0x00) ende--; // Füllnullen am Dateiende
			if (ende - daten < 2 || b[ende - 2] !== 0xff || b[ende - 1] !== 0xd9) return null;
			if (ende - 2 <= daten) return null; // keine Bilddaten
			return { typ: 'image/jpeg', ...masse };
		}
		i += 2 + laenge;
	}
	return null;
}

/** Bildtyp und Maße eines vollständig geprüften PNG/JPEG – oder `null`, wenn die Datei kaputt oder keins ist. */
export function pruefeBild(b: Uint8Array): BildInfo | null {
	try {
		return pruefePng(b) ?? pruefeJpeg(b);
	} catch {
		return null;
	}
}
