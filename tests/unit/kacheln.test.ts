import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bildArt, holeKachel, JE_NUTZER_MINUTE, kachelUrl, kachelVorlage, pruefeKachel, pruefeNutzerLimit, setzeKachelAbruf, STANDARD_URL, userAgent } from '../../src/lib/server/kacheln';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Kachel-Proxy (Jamil msg 2689): Prüfung, Vorlage, Kennung, Begrenzung, Zwischenspeicher. */
describe('Kartenkacheln über den eigenen Server', () => {
	let ordner: string;
	beforeAll(async () => {
		ordner = await mkdtemp(join(tmpdir(), 'kachel-test-'));
		process.env.KARTE_KACHEL_CACHE = ordner;
	});
	afterAll(async () => {
		setzeKachelAbruf(null);
		delete process.env.KARTE_KACHEL_CACHE;
		await rm(ordner, { recursive: true, force: true });
	});

	it('Kachel-Pfad prüfen', () => {
		expect(pruefeKachel('6', '33', '21')).toEqual({ z: 6, x: 33, y: 21 });
		expect(pruefeKachel('0', '0', '0')).toEqual({ z: 0, x: 0, y: 0 });
		expect(pruefeKachel('20', '0', '0')).toBeNull();
		expect(pruefeKachel('2', '4', '0')).toBeNull();
		expect(pruefeKachel('2', '-1', '0')).toBeNull();
		expect(pruefeKachel('2', '1.5', '0')).toBeNull();
		expect(pruefeKachel('2', '../x', '0')).toBeNull();
	});

	it('Vorlage aus KARTE_KACHEL_URL (nur https mit {z}/{x}/{y}), URL, Kennung', () => {
		expect(kachelVorlage(undefined)).toBe(STANDARD_URL);
		expect(kachelVorlage('https://tiles.example.org/{z}/{x}/{y}.png?key=abc')).toBe('https://tiles.example.org/{z}/{x}/{y}.png?key=abc');
		expect(kachelVorlage('http://tiles.example.org/{z}/{x}/{y}.png')).toBe(STANDARD_URL);
		expect(kachelVorlage('https://tiles.example.org/fest.png')).toBe(STANDARD_URL);
		expect(kachelUrl(STANDARD_URL, 6, 33, 21)).toBe('https://tile.openstreetmap.org/6/33/21.png');
		process.env.KARTE_KONTAKT = 'info@firma.de';
		expect(userAgent()).toMatch(/^waybuild-CRM\/1\.0 \(.*Kontakt: info@firma\.de\)$/);
		delete process.env.KARTE_KONTAKT;
	});

	it('Bildart', () => {
		expect(bildArt(PNG)).toBe('image/png');
		expect(bildArt(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
		expect(bildArt(new TextEncoder().encode('<html>blocked</html>'))).toBeNull();
	});

	it('Begrenzung je Nutzer und Minute', () => {
		for (let i = 0; i < JE_NUTZER_MINUTE; i++) pruefeNutzerLimit('n1', 1000);
		expect(() => pruefeNutzerLimit('n1', 1000)).toThrow(/Zu viele/);
		expect(() => pruefeNutzerLimit('n1', 61_001)).not.toThrow();
	});

	it('Zwischenspeicher: nur ein Abruf je Kachel; gesperrt (403/HTML) → Fehler, keine Datei', async () => {
		let n = 0;
		setzeKachelAbruf(async () => {
			n++;
			return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
		});
		const [a, b] = await Promise.all([holeKachel(3, 1, 1), holeKachel(3, 1, 1)]);
		expect(new Uint8Array(a)).toEqual(PNG);
		expect(new Uint8Array(b)).toEqual(PNG);
		expect(await holeKachel(3, 1, 1)).toBeTruthy();
		expect(n).toBe(1);
		setzeKachelAbruf(async () => new Response('Access blocked', { status: 403 }));
		await expect(holeKachel(3, 2, 2)).rejects.toMatchObject({ status: 502 });
		setzeKachelAbruf(async () => new Response('<html>', { status: 200 }));
		await expect(holeKachel(3, 3, 3)).rejects.toMatchObject({ status: 502 });
	});
});
