import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { aendereAuftrag, holeAuftrag, legeAuftragAn, listeAuftraege, sichtVon, uebernimmEinmalKunde } from '../../src/lib/server/auftraege';
import { einsaetzeZumAuftrag, legeEinsatzAn } from '../../src/lib/server/plantafel';
import { holeAngebot, legeAngebotAn, ladePdfDaten } from '../../src/lib/server/angebote';
import { actions as auftragAktionen, load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { actions as neuAktionen } from '../../src/routes/(app)/auftraege/neu/+page.server';
import { GET as pdfGet } from '../../src/routes/api/angebote/[id]/pdf/+server';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Phase 3 (Wunsch Jamil, 19.10.2026): Auftrag mit Kunde, mit Einmal-Kunde oder ohne Kunde. */
describe('Aufträge ohne Kunden / mit Einmal-Kunden', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const ALLE = () => sichtVon(u.chefA);
	const EINMAL = {
		kundeArt: 'einmal',
		einmalName: 'Frau Sommer',
		einmalTelefon: '040 123456',
		einmalEmail: 'sommer@beispiel.test',
		einmalStrasse: 'Gartenweg 2',
		einmalPlz: '22846',
		einmalOrt: 'Norderstedt'
	};
	const kundenZahl = async () => (await root`select count(*)::int as n from app.kunden`)[0].n as number;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('ohne Kunde: kundeId null, Name „Ohne Kunde“, keine Adresse', async () => {
		const a = await legeAuftragAn(kA(), { titel: 'Notdienst', kundeArt: 'ohne' });
		expect(a).toMatchObject({ kundeId: null, kundeArt: 'ohne', kundeName: 'Ohne Kunde', einmalKunde: null, adresse: null });
	});

	it('Einmal-Kunde: nur am Auftrag (keine Zeile in kunden), Name und Adresse aus den Einmal-Angaben; Suche findet ihn', async () => {
		const vorher = await kundenZahl();
		const a = await legeAuftragAn(kA(), { titel: 'Rohrbruch', ...EINMAL });
		expect(await kundenZahl()).toBe(vorher);
		expect(a).toMatchObject({
			kundeId: null,
			kundeArt: 'einmal',
			kundeName: 'Frau Sommer',
			adresse: 'Gartenweg 2, 22846 Norderstedt',
			einmalKunde: { name: 'Frau Sommer', telefon: '040 123456', email: 'sommer@beispiel.test' }
		});
		expect((await listeAuftraege(kA(), ALLE(), { suche: 'sommer' })).map((x) => x.id)).toContain(a.id);
	});

	it('Prüfung: Einmal ohne Namen, Kunde ohne kundeId, unbekannte Art, Objekt ohne Kunde → 400; ohne Art = Kunde (wie bisher)', async () => {
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeArt: 'einmal' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeArt: 'kunde' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAuftragAn(kA(), { titel: 'x' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeArt: 'irgendwas' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeArt: 'ohne', objektId: u.objektA })).rejects.toMatchObject({ status: 400 });
		await expect(legeAuftragAn(kA(), { titel: 'x', ...EINMAL, einmalName: 'y'.repeat(201) })).rejects.toMatchObject({ status: 400 });
		// Einmal-Angaben werden bei „ohne“/„kunde“ ignoriert
		const a = await legeAuftragAn(kA(), { titel: 'Mit Kunde', kundeId: u.kundeA, einmalName: 'egal' });
		expect(a).toMatchObject({ kundeArt: 'kunde', kundeId: u.kundeA, einmalKunde: null });
	});

	it('ändern: Einmal → Kunde (Einmal-Angaben weg), Kunde → ohne (Objekt weg), ohne Art-Angabe bleibt die Art', async () => {
		const a = await legeAuftragAn(kA(), { titel: 'Wechsel', ...EINMAL });
		expect(await aendereAuftrag(kA(), a.id, { titel: 'Wechsel 2' })).toMatchObject({ kundeArt: 'einmal', kundeName: 'Frau Sommer' });
		const b = await aendereAuftrag(kA(), a.id, { kundeArt: 'kunde', kundeId: u.kundeA, objektId: u.objektA });
		expect(b).toMatchObject({ kundeArt: 'kunde', kundeId: u.kundeA, objektId: u.objektA, einmalKunde: null });
		const c = await aendereAuftrag(kA(), a.id, { kundeArt: 'ohne' });
		expect(c).toMatchObject({ kundeArt: 'ohne', kundeId: null, objektId: null });
	});

	it('Termine (Plantafel) und Angebote funktionieren ohne Kunden; PDF nimmt die Einmal-Anschrift', async () => {
		const ohne = await legeAuftragAn(kA(), { titel: 'Ohne', kundeArt: 'ohne' });
		const einmal = await legeAuftragAn(kA(), { titel: 'Einmal', ...EINMAL });
		const beginn = new Date(Date.now() + 86_400_000);
		const ende = new Date(beginn.getTime() + 3_600_000);
		await legeEinsatzAn(kA(), { auftragId: einmal.id, benutzerId: u.ids.monteurA, beginn: beginn.toISOString(), ende: ende.toISOString() });
		const [t] = await einsaetzeZumAuftrag(kA(), einmal.id);
		expect(t).toMatchObject({ kundeName: 'Frau Sommer', ort: 'Gartenweg 2, 22846 Norderstedt' });
		const an = await legeAngebotAn(kA(), einmal.id);
		expect((await holeAngebot(kA(), an.id)).kundeName).toBe('Frau Sommer');
		expect((await ladePdfDaten(kA(), an.id)).kunde).toMatchObject({ name: 'Frau Sommer', strasse: 'Gartenweg 2', plz: '22846', ort: 'Norderstedt' });
		const an2 = await legeAngebotAn(kA(), ohne.id);
		expect((await ladePdfDaten(kA(), an2.id)).kunde).toMatchObject({ name: '', strasse: null });
		const pdf = await pdfGet({ locals: { nutzer: u.chefA }, params: { id: an.id } } as never);
		expect(pdf.status).toBe(200);
	});

	it('Einmal-Kunde in die Kundendatenbank übernehmen: Kunde angelegt und verknüpft; sonst 409', async () => {
		const a = await legeAuftragAn(kA(), { titel: 'Übernehmen', ...EINMAL });
		const n = await uebernimmEinmalKunde(kA(), a.id);
		expect(n).toMatchObject({ kundeArt: 'kunde', kundeName: 'Frau Sommer', einmalKunde: null, adresse: 'Gartenweg 2, 22846 Norderstedt' });
		const [kd] = await root`select art, nachname, telefon, email::text as email, strasse, plz, ort from app.kunden where id = ${n.kundeId}`;
		expect(kd).toEqual({ art: 'privat', nachname: 'Frau Sommer', telefon: '040 123456', email: 'sommer@beispiel.test', strasse: 'Gartenweg 2', plz: '22846', ort: 'Norderstedt' });
		await expect(uebernimmEinmalKunde(kA(), a.id)).rejects.toMatchObject({ status: 409 });
	});

	it('Seiten: „Neuer Auftrag“ mit Einmal-Kunde; Auftragsseite ohne Kunden-Hinweise; Übernehmen nur mit „Kunden bearbeiten“', async () => {
		const body = new URLSearchParams({ titel: 'Formular Einmal', ...EINMAL });
		let ort = '';
		try {
			await neuAktionen.anlegen({ locals: { nutzer: u.chefA }, request: new Request('http://localhost/x', { method: 'POST', body }) } as never);
		} catch (e: any) {
			ort = e.location;
		}
		const id = ort.split('/').pop()!;
		expect(await holeAuftrag(kA(), ALLE(), id)).toMatchObject({ kundeArt: 'einmal', kundeName: 'Frau Sommer' });
		const d = (await auftragLoad({ locals: { nutzer: u.chefA }, params: { id } } as never)) as any;
		expect(d.kundenHinweise).toBeNull();
		expect(d.darfKundeUebernehmen).toBe(true);
		const leer = new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams() });
		expect(((await auftragAktionen.kundeUebernehmen({ locals: { nutzer: u.monteurA }, params: { id }, request: leer } as never)) as any).status).toBe(403);
		let weiter = '';
		try {
			await auftragAktionen.kundeUebernehmen({ locals: { nutzer: u.bueroA }, params: { id }, request: leer } as never);
		} catch (e: any) {
			weiter = e.location;
		}
		expect(weiter).toMatch(/^\/kunden\/[0-9a-f-]{36}$/);
	});
});
