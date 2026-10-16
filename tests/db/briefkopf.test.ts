import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { holeLogo, holeProfil, speichereLogo, speichereProfil } from '../../src/lib/server/betriebsprofil';
import { GET as profilGet, PUT as profilPut } from '../../src/routes/api/einstellungen/briefkopf/+server';
import {
	DELETE as logoDelete,
	GET as logoGet,
	POST as logoPost
} from '../../src/routes/api/einstellungen/briefkopf/logo/+server';
import { actions as seitenAktionen, load as seitenLoad } from '../../src/routes/(app)/einstellungen/briefkopf/+page.server';
import { antwort, baueUmgebung, jsonAnfrage, testPng, type Umgebung } from './hilfe-1c';

const MELDUNG = 'Bitte ein PNG- oder JPEG-Bild bis 1 MB hochladen';

/** Minimales JPEG (SOI, APP0, SOF0 mit Höhe/Breite, EOI) – genügt der Kopfprüfung. */
function testJpeg(breite: number, hoehe: number): Uint8Array {
	return new Uint8Array([
		0xff, 0xd8,
		0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
		0xff, 0xc0, 0x00, 0x0b, 0x08, hoehe >> 8, hoehe & 255, breite >> 8, breite & 255, 0x01, 0x01, 0x11, 0x00,
		0xff, 0xd9
	]);
}

const dateiAnfrage = (bytes: Uint8Array, name = 'logo.png', typ = 'image/png') => {
	const form = new FormData();
	form.append('logo', new File([bytes as BlobPart], name, { type: typ }));
	return new Request('http://localhost/api/einstellungen/briefkopf/logo', { method: 'POST', body: form });
};

describe('Briefkopf und Logo', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	const get = async (nutzer: Nutzer | null) => antwort(await profilGet({ locals: { nutzer } } as never));
	const put = async (nutzer: Nutzer | null, koerper: unknown) =>
		antwort(await profilPut({ locals: { nutzer }, request: jsonAnfrage('PUT', koerper) } as never));
	const hochladen = async (nutzer: Nutzer | null, bytes: Uint8Array, name?: string, typ?: string) =>
		antwort(await logoPost({ locals: { nutzer }, request: dateiAnfrage(bytes, name, typ) } as never));
	const logo = async (nutzer: Nutzer | null) => logoGet({ locals: { nutzer } } as never);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.betrieb_profil`;
	});

	it('leeres Profil, speichern, IBAN ohne Leerzeichen, E-Mail/IBAN grob geprüft', async () => {
		const leer = await get(u.chefA);
		expect(leer.status).toBe(200);
		expect(leer.koerper).toMatchObject({ firmenname: null, hatLogo: false });
		const r = await put(u.chefA, {
			firmenname: 'Bauwelt Handwerk GmbH',
			strasse: 'Musterweg 1',
			plz: '22846',
			ort: 'Norderstedt',
			email: 'info@bauwelt.example',
			iban: 'de89 3704 0044 0532 0130 00',
			bic: 'COBADEFFXXX',
			fusszeile: 'Wir freuen uns auf Sie.'
		});
		expect(r.status).toBe(200);
		expect(r.koerper).toMatchObject({ firmenname: 'Bauwelt Handwerk GmbH', iban: 'DE89370400440532013000', hatLogo: false });
		expect(r.koerper).not.toHaveProperty('logo');
		expect((await holeProfil(kA())).ort).toBe('Norderstedt');
		// teilweise ändern lässt andere Felder stehen; leere Felder werden null
		const r2 = await put(u.chefA, { telefon: '040 123', ort: '' });
		expect(r2.koerper).toMatchObject({ telefon: '040 123', ort: null, firmenname: 'Bauwelt Handwerk GmbH' });
		for (const falsch of [{ email: 'kein-at' }, { iban: 'DE12' }, { iban: 'DE89 3704 0044 0532 0130 00 1234 5678 9012 3' }, { bic: 'X' }, { plz: 'x'.repeat(21) }]) {
			expect((await put(u.chefA, falsch)).status, JSON.stringify(falsch)).toBe(400);
		}
		expect((await put(u.chefA, { unbekannt: 'x' })).status).toBe(400);
		// Betrieb B sieht das Profil von A nicht
		expect((await get(u.chefB)).koerper).toMatchObject({ firmenname: null });
	});

	it('echtes PNG → ok, hatLogo true, GET liefert die Bytes mit image/png', async () => {
		const png = testPng(40, 20);
		const r = await hochladen(u.chefA, png);
		expect(r.status).toBe(200);
		expect(r.koerper).toMatchObject({ hatLogo: true });
		expect((await get(u.chefA)).koerper.hatLogo).toBe(true);
		const antwortLogo = await logo(u.chefA);
		expect(antwortLogo.status).toBe(200);
		expect(antwortLogo.headers.get('content-type')).toBe('image/png');
		expect(antwortLogo.headers.get('cache-control')).toContain('no-store');
		expect(new Uint8Array(await antwortLogo.arrayBuffer())).toEqual(png);
		// JPEG geht ebenso
		await speichereLogo(kA(), testJpeg(300, 120));
		expect((await holeLogo(kA()))?.typ).toBe('image/jpeg');
	});

	it('umbenannte Textdatei, 1 MB + 1 Byte, PNG 2000×10 → 400; altes Logo bleibt', async () => {
		const alt = testPng(8, 8);
		await speichereLogo(kA(), alt);
		const html = new TextEncoder().encode('<html><body>kein Bild</body></html>');
		const r1 = await hochladen(u.chefA, html, 'logo.png', 'image/png');
		expect(r1).toMatchObject({ status: 400, koerper: { fehler: MELDUNG } });
		const gross = new Uint8Array(1_048_577);
		gross.set(testPng(10, 10));
		const r2 = await hochladen(u.chefA, gross);
		expect(r2).toMatchObject({ status: 400, koerper: { fehler: MELDUNG } });
		const r3 = await hochladen(u.chefA, testPng(2000, 10));
		expect(r3.status).toBe(400);
		expect(r3.koerper.fehler).toContain('1500');
		await expect(speichereLogo(kA(), testJpeg(1501, 100))).rejects.toMatchObject({ status: 400 });
		await expect(speichereLogo(kA(), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).rejects.toMatchObject({ status: 400 });
		expect((await holeLogo(kA()))?.bytes).toEqual(alt);
		// genau 1 MB ist erlaubt
		const genau = new Uint8Array(1_048_576);
		genau.set(testPng(10, 10));
		expect((await hochladen(u.chefA, genau)).status).toBe(200);
	});

	it('Logo löschen; Rechte: ohne „einstellungen“ 403, Logo-Vorschau auch mit angebote.bearbeiten', async () => {
		await speichereLogo(kA(), testPng());
		expect((await put(u.bueroA, { firmenname: 'X' })).status).toBe(403);
		expect((await hochladen(u.bueroA, testPng())).status).toBe(403);
		expect((await get(u.bueroA)).status).toBe(403);
		expect((await logo(u.bueroA)).status).toBe(200);
		expect((await logo(u.monteurA)).status).toBe(403);
		expect((await logo(null)).status).toBe(401);
		expect((await logo(u.admin)).status).toBe(403);
		expect((await antwort(await logoDelete({ locals: { nutzer: u.bueroA } } as never))).status).toBe(403);
		const weg = await antwort(await logoDelete({ locals: { nutzer: u.chefA } } as never));
		expect(weg.status).toBe(200);
		expect(weg.koerper.hatLogo).toBe(false);
		expect((await logo(u.chefA)).status).toBe(404);
	});

	it('Seite: Büro 403, Chef sieht Formular; Aktion speichern', async () => {
		await expect(seitenLoad({ locals: { nutzer: u.bueroA } } as never)).rejects.toMatchObject({ status: 403 });
		const daten = (await seitenLoad({ locals: { nutzer: u.chefA } } as never)) as any;
		expect(daten.profil.hatLogo).toBe(false);
		const body = new URLSearchParams({ firmenname: 'Bauwelt', ort: 'Norderstedt', iban: '' });
		const erg = await seitenAktionen.speichern({
			locals: { nutzer: u.chefA },
			request: new Request('http://localhost/einstellungen/briefkopf', { method: 'POST', body })
		} as never);
		expect(erg).toMatchObject({ gespeichert: true });
		expect((await holeProfil(kA())).firmenname).toBe('Bauwelt');
		const form = new FormData();
		form.append('logo', new File([new TextEncoder().encode('<html>')], 'logo.png', { type: 'image/png' }));
		const fehl = await seitenAktionen.logo({
			locals: { nutzer: u.chefA },
			request: new Request('http://localhost/einstellungen/briefkopf', { method: 'POST', body: form })
		} as never);
		expect(fehl).toMatchObject({ status: 400, data: { fehler: MELDUNG } });
		await expect(speichereProfil(kA(), { firmenname: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
	});
});
