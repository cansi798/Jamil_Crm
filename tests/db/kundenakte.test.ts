import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import {
	holeKundenDatei,
	KUNDEN_DATEI_MAX,
	legeKundenNotizAn,
	listeKundenDateien,
	listeKundenNotizen,
	loescheKundenDatei,
	loescheKundenNotiz,
	speichereKundenDatei
} from '../../src/lib/server/kundenakte';
import { actions as kundenAktionen, load as kundenLoad } from '../../src/routes/(app)/kunden/[id]/+page.server';
import { GET as dokumentGet } from '../../src/routes/(app)/kunden/[id]/dokumente/[datei]/+server';
import { baueUmgebung, testPng, UNBEKANNT, type Umgebung } from './hilfe-1c';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe('Kundenakte: Notizen und Dokumente', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.kunden_notizen`;
		await root`delete from app.kunden_dateien`;
	});

	describe('Dienst', () => {
		it('Notizen: anlegen (bereinigt, mit Verfasser), neueste zuerst, löschen; leer/zu lang → 400', async () => {
			await legeKundenNotizAn(kA(), u.kundeA, 'Erste Notiz');
			await legeKundenNotizAn(kA(), u.kundeA, '  Hund im Garten – bitte klingeln  ');
			const liste = await listeKundenNotizen(kA(), u.kundeA);
			expect(liste.map((n) => [n.text, n.vonName])).toEqual([
				['Hund im Garten – bitte klingeln', 'Chef A'],
				['Erste Notiz', 'Chef A']
			]);
			await expect(legeKundenNotizAn(kA(), u.kundeA, '   ')).rejects.toMatchObject({ status: 400 });
			await expect(legeKundenNotizAn(kA(), u.kundeA, 'x'.repeat(10001))).rejects.toMatchObject({ status: 400 });
			await loescheKundenNotiz(kA(), u.kundeA, liste[1].id);
			expect(await listeKundenNotizen(kA(), u.kundeA)).toHaveLength(1);
			await expect(loescheKundenNotiz(kA(), u.kundeA, liste[1].id)).rejects.toMatchObject({ status: 404 });
		});

		it('Mandanten: fremder Kunde/fremde Notiz → 404, Betrieb B sieht nichts', async () => {
			const n = await legeKundenNotizAn(kA(), u.kundeA, 'Nur A');
			await expect(legeKundenNotizAn(kA(), u.kundeB, 'x')).rejects.toMatchObject({ status: 404 });
			await expect(listeKundenNotizen(kB(), u.kundeA)).rejects.toMatchObject({ status: 404 });
			await expect(loescheKundenNotiz(kB(), u.kundeA, n.id)).rejects.toMatchObject({ status: 404 });
			await expect(listeKundenNotizen(kA(), UNBEKANNT)).rejects.toMatchObject({ status: 404 });
			await expect(listeKundenNotizen(kA(), 'kaputt')).rejects.toMatchObject({ status: 404 });
		});

		it('Dokumente: PDF/PNG speichern, Liste ohne Inhalt, laden mit Inhalt, löschen', async () => {
			const d = await speichereKundenDatei(kA(), u.kundeA, { name: 'Vertrag.pdf', typ: 'application/pdf', inhalt: PDF, beschreibung: 'Rahmenvertrag' });
			await speichereKundenDatei(kA(), u.kundeA, { name: 'Foto.png', typ: 'image/png', inhalt: testPng(4, 2) });
			const liste = await listeKundenDateien(kA(), u.kundeA);
			expect(liste.map((x) => [x.name, x.typ, x.vonName])).toEqual([
				['Foto.png', 'image/png', 'Chef A'],
				['Vertrag.pdf', 'application/pdf', 'Chef A']
			]);
			expect(JSON.stringify(liste)).not.toContain('inhalt');
			const voll = await holeKundenDatei(kA(), u.kundeA, d.id);
			expect(Buffer.from(voll.inhalt).equals(Buffer.from(PDF))).toBe(true);
			expect(voll.beschreibung).toBe('Rahmenvertrag');
			await expect(holeKundenDatei(kB(), u.kundeA, d.id)).rejects.toMatchObject({ status: 404 });
			await expect(holeKundenDatei(kA(), u.kundeB, d.id)).rejects.toMatchObject({ status: 404 });
			await loescheKundenDatei(kA(), u.kundeA, d.id);
			await expect(holeKundenDatei(kA(), u.kundeA, d.id)).rejects.toMatchObject({ status: 404 });
		});

		it('Dokumente prüfen: zu groß → 413, leer/unerlaubter Typ/Inhalt passt nicht zum Typ → 400; Name wird bereinigt', async () => {
			const gross = new Uint8Array(KUNDEN_DATEI_MAX + 1);
			gross.set(PDF);
			await expect(speichereKundenDatei(kA(), u.kundeA, { name: 'g.pdf', typ: 'application/pdf', inhalt: gross })).rejects.toMatchObject({ status: 413 });
			await expect(speichereKundenDatei(kA(), u.kundeA, { name: 'l.pdf', typ: 'application/pdf', inhalt: new Uint8Array() })).rejects.toMatchObject({ status: 400 });
			await expect(
				speichereKundenDatei(kA(), u.kundeA, { name: 'x.html', typ: 'text/html', inhalt: new TextEncoder().encode('<script>') })
			).rejects.toMatchObject({ status: 400 });
			// als PDF ausgegeben, ist aber HTML
			await expect(
				speichereKundenDatei(kA(), u.kundeA, { name: 'fake.pdf', typ: 'application/pdf', inhalt: new TextEncoder().encode('<html>') })
			).rejects.toMatchObject({ status: 400 });
			const d = await speichereKundenDatei(kA(), u.kundeA, { name: '../../etc/pass\u0007wd.pdf', typ: 'application/pdf', inhalt: PDF });
			expect(d.name).toBe('passwd.pdf');
			expect(await root`select 1 from app.kunden_dateien`).toHaveLength(1);
		});
	});

	describe('Kundenseite (Laden, Aktionen, Download)', () => {
		const form = (felder: Record<string, string | Blob>) => {
			const f = new FormData();
			for (const [k, v] of Object.entries(felder)) f.append(k, v as never);
			return new Request('http://localhost/kunden/x', { method: 'POST', body: f });
		};
		const aufruf = (nutzer: Nutzer, felder: Record<string, string | Blob>) =>
			({ locals: { nutzer }, params: { id: u.kundeA }, request: form(felder) }) as never;

		it('Büro: Notiz und Dokument über die Seite; Laden zeigt beides; Monteur sieht, darf aber nicht schreiben', async () => {
			expect(await kundenAktionen.notizAnlegen(aufruf(u.bueroA, { text: 'Zahlt immer pünktlich' }))).toBeUndefined();
			expect(
				await kundenAktionen.dokumentHochladen(
					aufruf(u.bueroA, { datei: new File([PDF], 'Angebot alt.pdf', { type: 'application/pdf' }), beschreibung: 'Altes Angebot' })
				)
			).toBeUndefined();
			const d = (await kundenLoad({ locals: { nutzer: u.monteurA }, params: { id: u.kundeA } } as never)) as any;
			expect(d.notizen.map((n: any) => n.text)).toEqual(['Zahlt immer pünktlich']);
			expect(d.dokumente.map((x: any) => [x.name, x.beschreibung])).toEqual([['Angebot alt.pdf', 'Altes Angebot']]);
			expect(d.darfBearbeiten).toBe(false);
			expect(((await kundenAktionen.notizAnlegen(aufruf(u.monteurA, { text: 'x' }))) as any).status).toBe(403);
			expect(
				((await kundenAktionen.dokumentLoeschen(aufruf(u.monteurA, { id: d.dokumente[0].id }))) as any).status
			).toBe(403);
			expect(((await kundenAktionen.notizLoeschen(aufruf(u.monteurA, { id: d.notizen[0].id }))) as any).status).toBe(403);
			// Fehler kommen als Formularfehler zurück
			const leer = (await kundenAktionen.notizAnlegen(aufruf(u.bueroA, { text: ' ' }))) as any;
			expect(leer.status).toBe(400);
			expect(leer.data).toMatchObject({ notizFehler: expect.any(String) });
			const ohneDatei = (await kundenAktionen.dokumentHochladen(aufruf(u.bueroA, {}))) as any;
			expect(ohneDatei.status).toBe(400);
			expect(await kundenAktionen.dokumentLoeschen(aufruf(u.bueroA, { id: d.dokumente[0].id }))).toBeUndefined();
			expect(await kundenAktionen.notizLoeschen(aufruf(u.bueroA, { id: d.notizen[0].id }))).toBeUndefined();
		});

		it('Download: Anhang mit Dateiname und nosniff; Monteur (kunden.lesen) darf; fremd → 404, Betrieb ohne Recht → 403', async () => {
			const d = await speichereKundenDatei(kA(), u.kundeA, { name: 'Plan Bad.pdf', typ: 'application/pdf', inhalt: PDF });
			const r = await dokumentGet({ locals: { nutzer: u.monteurA }, params: { id: u.kundeA, datei: d.id } } as never);
			expect(r.status).toBe(200);
			expect(r.headers.get('content-type')).toBe('application/pdf');
			expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="Plan Bad.pdf"; filename\*=UTF-8''Plan%20Bad.pdf$/);
			expect(r.headers.get('x-content-type-options')).toBe('nosniff');
			expect(Buffer.from(await r.arrayBuffer()).equals(Buffer.from(PDF))).toBe(true);
			const fremd = await dokumentGet({ locals: { nutzer: u.chefB }, params: { id: u.kundeA, datei: d.id } } as never);
			expect(fremd.status).toBe(404);
			const ohne = nutzerOhneKunden(u);
			expect((await dokumentGet({ locals: { nutzer: ohne }, params: { id: u.kundeA, datei: d.id } } as never)).status).toBe(403);
		});
	});
});

function nutzerOhneKunden(u: Umgebung): Nutzer {
	return { id: u.ids.monteurA, betriebId: u.betriebA, istAdmin: false, rechte: ['auftraege.lesen'], betriebStatus: 'aktiv' };
}
