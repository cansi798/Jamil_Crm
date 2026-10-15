import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/**
 * Erzeugt die App-Symbole für das Manifest (static/icons/icon-192.png, icon-512.png): Fläche in der Primärfarbe
 * #05346B, darauf ein weißes „C“ (Ring mit Öffnung nach rechts). Das Motiv liegt innerhalb der sicheren Zone für
 * „maskable“ (Kreis mit 40 % Radius). Ohne Bildbibliothek: PNG wird direkt geschrieben, mit 4×4-Kantenglättung.
 *
 * Aufruf (selten nötig, die PNGs sind eingecheckt): `npx tsx scripts/erzeuge-icons.ts`
 */

const PRIMAER = [0x05, 0x34, 0x6b];
const WEISS = [0xff, 0xff, 0xff];

const CRC_TABELLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(daten: Buffer): number {
	let c = 0xffffffff;
	for (const b of daten) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function block(typ: string, inhalt: Buffer): Buffer {
	const laenge = Buffer.alloc(4);
	laenge.writeUInt32BE(inhalt.length);
	const typUndInhalt = Buffer.concat([Buffer.from(typ, 'ascii'), inhalt]);
	const pruef = Buffer.alloc(4);
	pruef.writeUInt32BE(crc32(typUndInhalt));
	return Buffer.concat([laenge, typUndInhalt, pruef]);
}

/** Anteil (0…1) eines Punktes, der zum weißen „C“ gehört. */
function imMotiv(x: number, y: number): boolean {
	// Koordinaten relativ zur Mitte, in Einheiten der Kantenlänge
	const dx = x - 0.5;
	const dy = y - 0.5;
	const r = Math.hypot(dx, dy);
	if (r < 0.19 || r > 0.31) return false;
	// Öffnung nach rechts: ±42° um die Waagerechte
	const winkel = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
	return winkel > 42;
}

export function erzeugePng(groesse: number): Buffer {
	const STUFEN = 4;
	const zeilen: Buffer[] = [];
	for (let py = 0; py < groesse; py++) {
		const zeile = Buffer.alloc(1 + groesse * 4); // Filterbyte 0 + RGBA
		for (let px = 0; px < groesse; px++) {
			let treffer = 0;
			for (let sy = 0; sy < STUFEN; sy++) {
				for (let sx = 0; sx < STUFEN; sx++) {
					if (imMotiv((px + (sx + 0.5) / STUFEN) / groesse, (py + (sy + 0.5) / STUFEN) / groesse)) treffer++;
				}
			}
			const a = treffer / (STUFEN * STUFEN);
			const o = 1 + px * 4;
			for (let k = 0; k < 3; k++) zeile[o + k] = Math.round(PRIMAER[k] * (1 - a) + WEISS[k] * a);
			zeile[o + 3] = 255;
		}
		zeilen.push(zeile);
	}
	const kopf = Buffer.alloc(13);
	kopf.writeUInt32BE(groesse, 0);
	kopf.writeUInt32BE(groesse, 4);
	kopf[8] = 8; // Bittiefe
	kopf[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		block('IHDR', kopf),
		block('IDAT', deflateSync(Buffer.concat(zeilen), { level: 9 })),
		block('IEND', Buffer.alloc(0))
	]);
}

const ZIEL = fileURLToPath(new URL('../static/icons/', import.meta.url));
mkdirSync(ZIEL, { recursive: true });
for (const groesse of [192, 512]) {
	writeFileSync(`${ZIEL}icon-${groesse}.png`, erzeugePng(groesse));
	console.log(`static/icons/icon-${groesse}.png geschrieben`);
}
