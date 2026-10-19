import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { holeAngebot, legeAngebotAn, setzeAngebotStatus, speicherePositionen, wendeAngebotVorlageAn } from '../../src/lib/server/angebote';
import {
	aendereAngebotVorlage,
	holeAngebotVorlage,
	legeAngebotVorlageAn,
	listeAngebotVorlagen,
	loescheAngebotVorlage
} from '../../src/lib/server/angebot-vorlagen';
import { aenderePosition, legePositionAn } from '../../src/lib/server/katalog';
import { GET as listeGet, POST as vorlagePost } from '../../src/routes/api/angebot-vorlagen/+server';
import { DELETE as vorlageDelete, GET as vorlageGet, PUT as vorlagePut } from '../../src/routes/api/angebot-vorlagen/[id]/+server';
import { POST as anwendenPost } from '../../src/routes/api/angebote/[id]/vorlage/+server';
import { actions as auftragAktionen } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, UNBEKANNT, type Umgebung } from './hilfe-1c';

describe('Angebots-Vorlagen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let fliesen: string; // Katalogposition A: 30 € Lohn + 15,50 € Material
	let silikon: string; // Katalogposition A: 8 € Lohn
	let fremdKatalog: string; // Katalogposition in Betrieb B
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });

	const BAD = {
		name: 'Bad komplett',
		einleitung: 'Gerne bieten wir Ihnen die Badsanierung an:',
		schluss: 'Mit freundlichen Grüßen',
		positionen: [] as Record<string, unknown>[]
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await leereAngebote(root);
		await root`delete from app.angebot_vorlagen`;
		await root`delete from app.katalog_positionen`;
		fliesen = (await legePositionAn(kA(), { bezeichnung: 'Fliesen verlegen', einheit: 'm²', lohn: '30', material: '15,50' })).id;
		silikon = (await legePositionAn(kA(), { bezeichnung: 'Silikonfugen', einheit: 'lfm', lohn: '8' })).id;
		fremdKatalog = (await legePositionAn(kB(), { bezeichnung: 'Fremd', einheit: 'Stk', lohn: '1' })).id;
		BAD.positionen = [
			{ katalogPositionId: fliesen, menge: '12,5' },
			{ bezeichnung: 'Anfahrt', menge: 1, einheit: 'psch', einzelpreis: '45,00' },
			{ katalogPositionId: silikon, bezeichnung: 'Silikonfugen erneuern', beschreibung: 'Bad und Küche', menge: '6' }
		];
	});

	describe('Dienst', () => {
		it('anlegen und lesen: Katalogpositionen ohne Preis (Text aus dem Katalog als Vorschlag), freie mit Preis', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			expect(v).toMatchObject({ name: 'Bad komplett', einleitung: BAD.einleitung, schluss: BAD.schluss });
			expect(v.positionen.map((p) => [p.pos, p.katalogPositionId, p.bezeichnung, p.beschreibung, p.menge, p.einheit, p.einzelpreisCent])).toEqual([
				[1, fliesen, 'Fliesen verlegen', null, 12.5, 'm²', null],
				[2, null, 'Anfahrt', null, 1, 'psch', 4500],
				[3, silikon, 'Silikonfugen erneuern', 'Bad und Küche', 6, 'lfm', null]
			]);
			// aktueller Katalogpreis zur Anzeige
			expect(v.positionen.map((p) => p.katalogPreisCent)).toEqual([4550, null, 800]);
			// ein mitgeschickter Preis an einer Katalogposition wird ignoriert (Preis kommt beim Einfügen)
			const mitPreis = await legeAngebotVorlageAn(kA(), { name: 'X', positionen: [{ katalogPositionId: fliesen, menge: 1, einzelpreis: '1' }] });
			expect(mitPreis.positionen[0].einzelpreisCent).toBeNull();
			const liste = await listeAngebotVorlagen(kA());
			expect(liste.map((l) => [l.name, l.anzahlPositionen])).toEqual([
				['Bad komplett', 3],
				['X', 1]
			]);
		});

		it('Prüfung: Name Pflicht, fremde/unbekannte Katalogposition, freie Position ohne Bezeichnung/Einheit, zu viele → 400', async () => {
			await expect(legeAngebotVorlageAn(kA(), { name: ' ' })).rejects.toMatchObject({ status: 400 });
			await expect(legeAngebotVorlageAn(kA(), { name: 'x'.repeat(101) })).rejects.toMatchObject({ status: 400 });
			await expect(legeAngebotVorlageAn(kA(), { name: 'F', positionen: [{ katalogPositionId: fremdKatalog, menge: 1 }] })).rejects.toMatchObject({
				status: 400
			});
			await expect(legeAngebotVorlageAn(kA(), { name: 'F', positionen: [{ katalogPositionId: UNBEKANNT, menge: 1 }] })).rejects.toMatchObject({
				status: 400
			});
			await expect(legeAngebotVorlageAn(kA(), { name: 'F', positionen: [{ menge: 1, einheit: 'Stk' }] })).rejects.toThrow(/Position 1/);
			await expect(legeAngebotVorlageAn(kA(), { name: 'F', positionen: [{ bezeichnung: 'a', menge: 1, einheit: 'Eimer' }] })).rejects.toThrow(
				/Einheit/
			);
			await expect(legeAngebotVorlageAn(kA(), { name: 'F', positionen: [{ bezeichnung: 'a', menge: '0', einheit: 'Stk' }] })).rejects.toMatchObject({
				status: 400
			});
			const viele = Array.from({ length: 201 }, () => ({ bezeichnung: 'a', menge: 1, einheit: 'Stk' }));
			await expect(legeAngebotVorlageAn(kA(), { name: 'F', positionen: viele })).rejects.toMatchObject({ status: 400 });
			expect(await root`select 1 from app.angebot_vorlagen`).toHaveLength(0);
		});

		it('ändern ersetzt Kopf und Positionen; leere Texte → null; löschen; fremd/unbekannt → 404 (RLS)', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			const n = await aendereAngebotVorlage(kA(), v.id, {
				name: 'Bad klein',
				einleitung: '',
				schluss: '',
				positionen: [{ katalogPositionId: silikon, menge: 2 }]
			});
			expect(n).toMatchObject({ name: 'Bad klein', einleitung: null, schluss: null });
			expect(n.positionen.map((p) => [p.pos, p.bezeichnung])).toEqual([[1, 'Silikonfugen']]);
			await expect(holeAngebotVorlage(kB(), v.id)).rejects.toMatchObject({ status: 404 });
			await expect(aendereAngebotVorlage(kB(), v.id, { name: 'gekapert' })).rejects.toMatchObject({ status: 404 });
			await expect(loescheAngebotVorlage(kB(), v.id)).rejects.toMatchObject({ status: 404 });
			await expect(holeAngebotVorlage(kA(), 'kaputt')).rejects.toMatchObject({ status: 404 });
			expect(await listeAngebotVorlagen(kB())).toEqual([]);
			await loescheAngebotVorlage(kA(), v.id);
			expect(await root`select 1 from app.angebot_vorlagen_positionen`).toHaveLength(0);
		});

		it('Datenbank: Katalogposition mit Preis verboten; Katalogposition gelöscht → Vorlagenzeile bleibt (frei, ohne Preis)', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			await expect(
				root`update app.angebot_vorlagen_positionen set einzelpreis_cent = 1 where katalog_position_id = ${fliesen}`
			).rejects.toThrow(/angebot_vorlagen_positionen_preis/);
			await root`delete from app.katalog_positionen where id = ${silikon}`;
			const n = await holeAngebotVorlage(kA(), v.id);
			expect(n.positionen[2]).toMatchObject({ katalogPositionId: null, bezeichnung: 'Silikonfugen erneuern', einzelpreisCent: null });
		});
	});

	describe('Anwenden auf ein Angebot', () => {
		it('hängt Positionen an (Reihenfolge), Preise aus dem AKTUELLEN Katalog, Texte aus der Vorlage; alles danach änderbar', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			// Katalogpreis ändert sich nach dem Anlegen der Vorlage → beim Einfügen gilt der neue Preis
			await aenderePosition(kA(), fliesen, { lohn: '40' });
			const an = await legeAngebotAn(kA(), u.auftragA);
			await speicherePositionen(kA(), an.id, [{ bezeichnung: 'Schon da', menge: 1, einheit: 'Stk', einzelpreis: '10' }]);
			const neu = await wendeAngebotVorlageAn(kA(), an.id, v.id);
			expect(neu.positionen.map((p) => [p.pos, p.bezeichnung, p.menge, p.einheit, p.einzelpreisCent, p.katalogPositionId])).toEqual([
				[1, 'Schon da', 1, 'Stk', 1000, null],
				[2, 'Fliesen verlegen', 12.5, 'm²', 5550, fliesen],
				[3, 'Anfahrt', 1, 'psch', 4500, null],
				[4, 'Silikonfugen erneuern', 6, 'lfm', 800, silikon]
			]);
			expect(neu).toMatchObject({ einleitung: BAD.einleitung, schluss: BAD.schluss });
			// danach normal änderbar
			const geaendert = await speicherePositionen(
				kA(),
				an.id,
				neu.positionen.slice(1).map((p) => ({ katalogPositionId: p.katalogPositionId, bezeichnung: p.bezeichnung, menge: '2', einheit: p.einheit, einzelpreis: '1' }))
			);
			expect(geaendert.positionen.map((p) => p.einzelpreisCent)).toEqual([100, 100, 100]);
		});

		it('Vorlage ohne Texte lässt die Texte des Angebots stehen; Katalogposition weg → Zeile ohne Preis (Warnung)', async () => {
			const v = await legeAngebotVorlageAn(kA(), { name: 'Nur Silikon', positionen: [{ katalogPositionId: silikon, menge: 3 }] });
			await root`delete from app.katalog_positionen where id = ${silikon}`;
			const an = await legeAngebotAn(kA(), u.auftragA);
			const neu = await wendeAngebotVorlageAn(kA(), an.id, v.id);
			expect(neu.einleitung).toBe(an.einleitung);
			expect(neu.schluss).toBe(an.schluss);
			expect(neu.positionen.map((p) => [p.bezeichnung, p.einzelpreisCent])).toEqual([['Silikonfugen', 0]]);
			expect(neu.warnungen).toEqual(['preis_fehlt']);
		});

		it('nur Entwurf (409); fremde/unbekannte Vorlage → 404; mehr als 200 Positionen → 400 und nichts geändert', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			const fremd = await legeAngebotVorlageAn(kB(), { name: 'B', positionen: [] });
			const an = await legeAngebotAn(kA(), u.auftragA);
			await expect(wendeAngebotVorlageAn(kA(), an.id, fremd.id)).rejects.toMatchObject({ status: 404 });
			await expect(wendeAngebotVorlageAn(kA(), an.id, UNBEKANNT)).rejects.toMatchObject({ status: 404 });
			const voll = Array.from({ length: 199 }, () => ({ bezeichnung: 'a', menge: 1, einheit: 'Stk', einzelpreis: '1' }));
			await speicherePositionen(kA(), an.id, voll);
			await expect(wendeAngebotVorlageAn(kA(), an.id, v.id)).rejects.toMatchObject({ status: 400 });
			expect((await holeAngebot(kA(), an.id)).positionen).toHaveLength(199);
			await speicherePositionen(kA(), an.id, [{ bezeichnung: 'a', menge: 1, einheit: 'Stk', einzelpreis: '1' }]);
			await setzeAngebotStatus(kA(), an.id, 'versendet');
			await expect(wendeAngebotVorlageAn(kA(), an.id, v.id)).rejects.toMatchObject({ status: 409 });
		});

		it('„Angebot erstellen“ im Auftrag mit Vorlage → neuer Entwurf enthält die Vorlage; ohne Vorlage wie bisher', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			const form = (felder: Record<string, string>) => {
				const body = new URLSearchParams(felder);
				return new Request('http://localhost/auftraege/x', { method: 'POST', body });
			};
			const umleitung = async (fn: () => unknown) => {
				try {
					return { ergebnis: (await fn()) as any };
				} catch (e: any) {
					if (e?.status === 303) return { ort: e.location as string };
					throw e;
				}
			};
			const r = await umleitung(() =>
				auftragAktionen.angebotErstellen({ locals: { nutzer: u.chefA }, params: { id: u.auftragA }, request: form({ vorlageId: v.id }) } as never)
			);
			const id = r.ort!.split('/').pop()!;
			const an = await holeAngebot(kA(), id);
			expect(an.positionen.map((p) => p.bezeichnung)).toEqual(['Fliesen verlegen', 'Anfahrt', 'Silikonfugen erneuern']);
			expect(an.einleitung).toBe(BAD.einleitung);
			const ohne = await umleitung(() =>
				auftragAktionen.angebotErstellen({ locals: { nutzer: u.chefA }, params: { id: u.auftragA }, request: form({ vorlageId: '' }) } as never)
			);
			expect((await holeAngebot(kA(), ohne.ort!.split('/').pop()!)).positionen).toEqual([]);
			// fremde Vorlage → Fehler, kein neues Angebot
			const vorher = (await root`select count(*)::int as n from app.angebote`)[0].n;
			const fremd = await legeAngebotVorlageAn(kB(), { name: 'B' });
			const f = await umleitung(() =>
				auftragAktionen.angebotErstellen({ locals: { nutzer: u.chefA }, params: { id: u.auftragA }, request: form({ vorlageId: fremd.id }) } as never)
			);
			expect(f.ergebnis?.status).toBe(404);
			expect((await root`select count(*)::int as n from app.angebote`)[0].n).toBe(vorher);
		});
	});

	describe('API und Rechte (wie Angebote: angebote.bearbeiten + preise.sehen + Modul)', () => {
		const liste = async (nutzer: Nutzer | null) => antwort(await listeGet({ locals: { nutzer } } as never));
		const post = async (nutzer: Nutzer | null, k: unknown) => antwort(await vorlagePost({ locals: { nutzer }, request: jsonAnfrage('POST', k) } as never));
		const get = async (nutzer: Nutzer | null, id: string) => antwort(await vorlageGet({ locals: { nutzer }, params: { id } } as never));
		const put = async (nutzer: Nutzer | null, id: string, k: unknown) =>
			antwort(await vorlagePut({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PUT', k) } as never));
		const del = async (nutzer: Nutzer | null, id: string) => antwort(await vorlageDelete({ locals: { nutzer }, params: { id } } as never));
		const anwenden = async (nutzer: Nutzer | null, id: string, vorlageId: unknown) =>
			antwort(await anwendenPost({ locals: { nutzer }, params: { id }, request: jsonAnfrage('POST', { vorlageId }) } as never));

		it('Chef/Büro: anlegen 201, lesen, ändern, anwenden, löschen 204', async () => {
			const r = await post(u.bueroA, BAD);
			expect(r.status).toBe(201);
			expect((await liste(u.chefA)).koerper).toHaveLength(1);
			expect((await get(u.chefA, r.koerper.id)).koerper.positionen).toHaveLength(3);
			expect((await put(u.chefA, r.koerper.id, { name: 'Neu', positionen: [] })).koerper).toMatchObject({ name: 'Neu', positionen: [] });
			expect((await put(u.chefA, r.koerper.id, { unbekannt: 1 })).status).toBe(400);
			const an = await legeAngebotAn(kA(), u.auftragA);
			await put(u.chefA, r.koerper.id, BAD);
			const a = await anwenden(u.chefA, an.id, r.koerper.id);
			expect(a.status).toBe(200);
			expect(a.koerper.positionen).toHaveLength(3);
			expect((await anwenden(u.chefA, an.id, 'kaputt')).status).toBe(404);
			expect((await del(u.chefA, r.koerper.id)).status).toBe(204);
			expect((await del(u.chefA, r.koerper.id)).status).toBe(404);
		});

		it('ohne „Preise sehen“, Monteur → 403; Betrieb ohne Modul → 402; abgemeldet → 401; nichts mit Preisen sichtbar', async () => {
			const v = await legeAngebotVorlageAn(kA(), BAD);
			const an = await legeAngebotAn(kA(), u.auftragA);
			for (const n of [u.ohnePreiseA, u.nurAngeboteA, u.monteurA]) {
				expect((await liste(n)).status, n.id).toBe(403);
				expect((await get(n, v.id)).status).toBe(403);
				expect((await post(n, { name: 'x' })).status).toBe(403);
				expect((await anwenden(n, an.id, v.id)).status).toBe(403);
				expect(JSON.stringify((await get(n, v.id)).koerper)).not.toMatch(/4500|Cent/);
			}
			expect((await liste(u.chefC)).status).toBe(402);
			expect((await liste(null)).status).toBe(401);
		});
	});
});
