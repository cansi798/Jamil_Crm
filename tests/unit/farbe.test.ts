import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { dominanteFarbe, farbStil, farbTokens, kontrast, lesbareFuellung, STANDARD_FARBE } from '../../src/lib/farbe';
import { farbeAusLogo } from '../../src/lib/server/logo-farbe';

describe('farbTokens', () => {
	it('Standard ist Gold, Text darauf dunkel', () => {
		const t = farbTokens(null);
		expect(t['--ui-akzent']).toBe(STANDARD_FARBE);
		expect(t['--ui-akzent-auf']).toBe('#1f1e20');
	});
	it('ungültige Farbe → Gold', () => {
		expect(farbTokens('rot')['--ui-akzent']).toBe(STANDARD_FARBE);
		expect(farbTokens('#12345')['--ui-akzent']).toBe(STANDARD_FARBE);
	});
	it('dunkle Hausfarbe → weißer Text darauf', () => {
		expect(farbTokens('#1d4ed8')['--ui-akzent-auf']).toBe('#ffffff');
	});
	it('Akzenttext auf Weiß hat immer genug Kontrast', () => {
		for (const f of ['#c3a56f', '#ffd400', '#7fd1ae', '#1d4ed8', '#ffffff']) {
			expect(kontrast(farbTokens(f)['--ui-akzent-text'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
		}
	});
	it('Text auf der Füllung ist lesbar (≥ 4,5 : 1)', () => {
		for (const f of ['#c3a56f', '#ffd400', '#1d4ed8', '#b03a2e', '#3f7d4e']) {
			const t = farbTokens(f);
			expect(kontrast(t['--ui-akzent'], t['--ui-akzent-auf'])).toBeGreaterThanOrEqual(4.5);
		}
	});
	it('Inline-Stil enthält alle Tokens', () => {
		expect(farbStil('#c3a56f')).toContain('--ui-akzent-text: #');
	});
});

describe('Akzentfarbe aus dem Logo (msg 3016)', () => {
	const px = (hex: string, n: number, a = 255) => Array.from({ length: n }, () => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a] as const);
	it('größte bunte Farbe gewinnt; Weiß, Schwarz, Grau und Durchsichtiges zählen nicht', () => {
		const f = dominanteFarbe([...px('#ffffff', 5000), ...px('#000000', 3000), ...px('#808080', 2000), ...px('#c3a56f', 400), ...px('#1d4ed8', 150), ...px('#ff0000', 900, 0)]);
		expect(f).toBe('#c3a56f');
	});
	it('nur Schwarz/Weiß/Grau oder zu wenig Farbe → null', () => {
		expect(dominanteFarbe([...px('#ffffff', 500), ...px('#111111', 500), ...px('#999999', 500)])).toBeNull();
		expect(dominanteFarbe([...px('#ffffff', 10000), ...px('#1d4ed8', 10)])).toBeNull();
		expect(dominanteFarbe([])).toBeNull();
	});
	it('Füllung lesbar: Text darauf ≥ 4,5 : 1, sonst abgedunkelt bis weißer Text reicht', () => {
		for (const f of ['#808080', '#ff4d4d', '#e07b39', '#c3a56f', '#1d4ed8', '#7fd1ae']) {
			const { fuellung, auf } = lesbareFuellung(f);
			expect(kontrast(fuellung, auf), f).toBeGreaterThanOrEqual(4.5);
		}
		expect(lesbareFuellung('#c3a56f').fuellung).toBe('#c3a56f'); // Gold bleibt Gold (dunkler Text)
		const grau = lesbareFuellung('#808080');
		expect(grau.auf).toBe('#ffffff');
		expect(grau.fuellung).not.toBe('#808080');
	});
	it('PNG-Logo (RGBA, mit Zeilenfiltern) → Farbe; JPEG/kaputt → null', () => {
		const png = (b: number, h: number, pixel: (x: number, y: number) => number[], filter = 0) => {
			const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
			const crc = (d: Buffer) => { let c = 0xffffffff; for (const x of d) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
			const block = (typ: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(typ), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
			const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(b, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
			const zeilen: number[] = [];
			for (let y = 0; y < h; y++) {
				zeilen.push(filter);
				const roh = Array.from({ length: b }, (_, x) => pixel(x, y)).flat();
				// Filter 1 (Sub): Differenz zum linken Pixel
				zeilen.push(...roh.map((v, i) => (filter === 1 ? (v - (i >= 4 ? roh[i - 4] : 0)) & 255 : v)));
			}
			return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), block('IHDR', ihdr), block('IDAT', deflateSync(Buffer.from(zeilen))), block('IEND', Buffer.alloc(0))]));
		};
		// Bauwelt-ähnlich: weiße Schrift, goldenes Dach, Rest durchsichtig
		const logo = (x: number, y: number) => (y < 10 ? [0xc3, 0xa5, 0x6f, 255] : y < 30 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
		expect(farbeAusLogo(png(40, 40, logo))).toBe('#c3a56f');
		expect(farbeAusLogo(png(40, 40, logo, 1))).toBe('#c3a56f');
		expect(farbeAusLogo(png(20, 20, () => [255, 255, 255, 255]))).toBeNull();
		expect(farbeAusLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
	});
});
