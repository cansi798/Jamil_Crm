import postgres from 'postgres';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { holeProfil, loescheLogo, markenLogos, setzeHausfarbe, speichereLogo, speichereProfil } from '../../src/lib/server/betriebsprofil';
import { GET as markeGet } from '../../src/routes/api/marke/logo/+server';
import { load as layoutLoad } from '../../src/routes/(app)/+layout.server';
import { actions as seitenAktionen } from '../../src/routes/(app)/einstellungen/briefkopf/+page.server';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** RGBA-PNG (8 Bit, ohne Filter) aus einer Pixel-Funktion. */
function farbPng(b: number, h: number, pixel: (x: number, y: number) => number[]): Uint8Array {
	const crcT = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (d: Buffer) => {
		let c = 0xffffffff;
		for (const x of d) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const block = (typ: string, d: Buffer) => {
		const l = Buffer.alloc(4);
		l.writeUInt32BE(d.length);
		const td = Buffer.concat([Buffer.from(typ), d]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([l, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(b, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const roh: number[] = [];
	for (let y = 0; y < h; y++) roh.push(0, ...Array.from({ length: b }, (_, x) => pixel(x, y)).flat());
	return new Uint8Array(
		Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), block('IHDR', ihdr), block('IDAT', deflateSync(Buffer.from(roh))), block('IEND', Buffer.alloc(0))])
	);
}
const GOLD = farbPng(30, 30, (x, y) => (y < 8 ? [0xc3, 0xa5, 0x6f, 255] : [255, 255, 255, 255]));
const BLAU = farbPng(30, 30, (x, y) => (y < 8 ? [0x1d, 0x4e, 0xd8, 255] : [0, 0, 0, 0]));

/** Logo oben links (msg 3014) und Hausfarbe aus dem Logo (msg 3016). */
describe('Marke: Logo oben links und Akzentfarbe aus dem Logo', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await root`delete from app.betrieb_profil where betrieb_id in (${u.betriebA}, ${u.betriebB})`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('ohne Logo: keine Marke, Standardfarbe; Logo-Endpunkt 404', async () => {
		expect(await markenLogos(kA())).toEqual({ hell: null, dunkel: null, name: null });
		expect((await markeGet({ locals: { nutzer: u.monteurA }, url: new URL('http://t/api/marke/logo') } as never)).status).toBe(404);
		expect((await markeGet({ locals: { nutzer: null }, url: new URL('http://t/api/marke/logo') } as never)).status).toBe(401);
	});

	it('Logo hochladen → Farbe erkannt und als Hausfarbe übernommen; jeder Benutzer des Betriebs sieht das Logo', async () => {
		const p = await speichereLogo(kA(), GOLD);
		expect(p).toMatchObject({ hatLogo: true, logoFarbe: '#c3a56f', farbe: '#c3a56f', farbeEigen: false });
		const r = await markeGet({ locals: { nutzer: u.monteurA }, url: new URL('http://t/api/marke/logo') } as never);
		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toBe('image/png');
		// helle Variante fehlt noch → 404; Layout kennt nur das Briefkopf-Logo
		expect((await markeGet({ locals: { nutzer: u.monteurA }, url: new URL('http://t/api/marke/logo?variante=dunkel') } as never)).status).toBe(404);
		const l = (await layoutLoad({ locals: { nutzer: u.monteurA }, route: { id: '/(app)' } } as never)) as { marke: { hell: string | null; dunkel: string | null }; farbStil: string };
		expect(l.marke.hell).not.toBeNull();
		expect(l.marke.dunkel).toBeNull();
		expect(l.farbStil).toContain('--ui-akzent: #c3a56f');
	});

	it('helle Variante für die Seitenleiste; Betrieb B sieht nichts davon', async () => {
		const p = await speichereLogo(kA(), BLAU, 'dunkel');
		// die Farbe kommt weiter aus dem Briefkopf-Logo
		expect(p).toMatchObject({ hatLogoDunkel: true, logoFarbe: '#c3a56f', farbe: '#c3a56f' });
		expect((await markeGet({ locals: { nutzer: u.monteurA }, url: new URL('http://t/api/marke/logo?variante=dunkel') } as never)).status).toBe(200);
		expect((await markeGet({ locals: { nutzer: u.chefB }, url: new URL('http://t/api/marke/logo?variante=dunkel') } as never)).status).toBe(404);
		expect((await markenLogos({ betriebId: u.betriebB, benutzerId: u.ids.chefB })).dunkel).toBeNull();
	});

	it('eigene Farbe bleibt bei neuem Logo; „aus dem Logo übernehmen“ und „Zurücksetzen auf Standard“', async () => {
		// Farbwähler schickt unveränderte Farbe → keine eigene Wahl
		expect(await speichereProfil(kA(), { farbe: '#c3a56f' })).toMatchObject({ farbeEigen: false });
		expect(await speichereProfil(kA(), { farbe: '#3f7d4e' })).toMatchObject({ farbe: '#3f7d4e', farbeEigen: true });
		expect(await speichereLogo(kA(), BLAU)).toMatchObject({ logoFarbe: '#1d4ed8', farbe: '#3f7d4e' });
		expect(await setzeHausfarbe(kA(), 'logo')).toMatchObject({ farbe: '#1d4ed8', farbeEigen: false });
		expect(await setzeHausfarbe(kA(), 'standard')).toMatchObject({ farbe: null, farbeEigen: true });
		await expect(setzeHausfarbe(kA(), 'rot')).rejects.toMatchObject({ status: 400 });
		// Seite: Büro ohne „Einstellungen“ darf nicht
		const f = new FormData();
		f.set('wahl', 'logo');
		const r = (await seitenAktionen.hausfarbe({ locals: { nutzer: u.monteurA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never)) as { status: number };
		expect(r.status).toBe(403);
		await seitenAktionen.hausfarbe({ locals: { nutzer: u.chefA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never);
		expect((await holeProfil(kA())).farbe).toBe('#1d4ed8');
	});

	it('Logo ohne bunte Farbe → Standard; ohne jedes Logo keine Logo-Farbe mehr', async () => {
		expect(await speichereLogo(kA(), farbPng(10, 10, () => [20, 20, 20, 255]))).toMatchObject({ logoFarbe: null, farbe: null });
		await loescheLogo(kA());
		expect(await loescheLogo(kA(), 'dunkel')).toMatchObject({ hatLogo: false, hatLogoDunkel: false, logoFarbe: null, farbe: null });
		// Logo-Bytes nie im Änderungsprotokoll
		const [z] = await root`select count(*)::int as n from app.aenderungen where tabelle = 'betrieb_profil' and (nachher ? 'logo_dunkel' or nachher ? 'logo')`;
		expect(z.n).toBe(0);
	});
});
