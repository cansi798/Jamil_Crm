import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, testPng, type Umgebung } from './hilfe-1c';
import {
	auftragPartner,
	fuegeSubunternehmerHinzu,
	holeNachweisDatei,
	holePartner,
	legeFremdleistungAn,
	legePartnerAn,
	listePartner,
	loescheNachweis,
	loeschePartner,
	partnerAuswertung,
	partnerZugriff,
	setzeAuftraggeber,
	setzeQuellenPartner,
	speichereKontakt,
	speichereNachweis
} from '../../src/lib/server/partner';
import { nachkalkulationAuftrag } from '../../src/lib/server/nachkalkulation';

/** Partner (Jamil msgs 2854/2856): Rechte, RLS, Nachweise mit Erinnerung, Auftrag, Nachkalkulation, Auswertung. */
describe('Partner', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const ALLE = () => ({ alle: true, benutzerId: u.ids.chefA });
	const HEUTE = '2026-10-21';

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		// Rollen der Testumgebung: Chef bekommt das neue Recht (Migration 094 ergänzt es bei Chef/Büro-Rollen)
		await root`update app.rollen set rechte = array_append(rechte, 'partner.verwalten') where betrieb_id = ${u.betriebA} and not ('partner.verwalten' = any(rechte)) and ('einstellungen' = any(rechte))`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Rechte: nur mit „Partner verwalten“; anderer Betrieb sieht nichts', async () => {
		await expect(partnerZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		await expect(partnerZugriff({ nutzer: u.chefA })).resolves.toMatchObject({ betriebId: u.betriebA });
		const p = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'Hornbach Norderstedt', provisionProzent: '5' });
		expect((await listePartner(kB())).map((x) => x.id)).not.toContain(p.id);
		await expect(holePartner(kB(), p.id)).rejects.toMatchObject({ status: 404 });
	});

	it('Nachweis mit Ablauf: Datei geprüft, Aufgabe 30 Tage vorher, Erinnerung an die Verwalter; ersetzen und löschen räumen auf', async () => {
		const p = await legePartnerAn(kA(), { art: 'subunternehmer', name: 'Elektro Kaya' });
		await speichereKontakt(kA(), p.id, null, { name: 'Murat Kaya', rolle: 'Chef', telefon: '0170 123' });
		await expect(speichereNachweis(kA(), p.id, null, { art: 'versicherung', gueltigBis: '2026-12-31', datei: { name: 'x.html', inhalt: new TextEncoder().encode('<html>') } }, HEUTE)).rejects.toMatchObject({ status: 400 });
		const nid = await speichereNachweis(kA(), p.id, null, { art: 'freistellung_48b', gueltigBis: '2026-12-31', datei: { name: 'freistellung.png', inhalt: testPng() } }, HEUTE);
		const [n] = await root`select todo_id from app.partner_nachweise where id = ${nid}`;
		const [t] = await root`select titel, to_char(faellig, 'YYYY-MM-DD') as faellig, zustaendig_id from app.todos where id = ${n.todo_id}`;
		expect(t).toMatchObject({ titel: 'Nachweis erneuern: Freistellungsbescheinigung § 48b – Elektro Kaya', faellig: '2026-12-01', zustaendig_id: u.ids.chefA });
		const er = await root`select benutzer_id, link from app.erinnerungen where todo_id = ${n.todo_id}`;
		expect(er.map((x) => x.benutzer_id)).toContain(u.ids.chefA);
		expect(er.map((x) => x.benutzer_id)).not.toContain(u.ids.monteurA);
		expect(er[0].link).toBe(`/partner/${p.id}`);
		expect((await holeNachweisDatei(kA(), p.id, nid)).typ).toBe('image/png');
		// neues Ablaufdatum → alte offene Aufgabe weg, neue da
		await speichereNachweis(kA(), p.id, nid, { art: 'freistellung_48b', gueltigBis: '2027-06-30' }, HEUTE);
		expect(await root`select 1 from app.todos where id = ${n.todo_id}`).toHaveLength(0);
		const [n2] = await root`select todo_id, datei_name from app.partner_nachweise where id = ${nid}`;
		expect(n2.datei_name).toBe('freistellung.png'); // Datei bleibt
		await loescheNachweis(kA(), p.id, nid);
		expect(await root`select 1 from app.todos where id = ${n2.todo_id}`).toHaveLength(0);
		// schon abgelaufen → Warnung in der Liste
		await speichereNachweis(kA(), p.id, null, { art: 'versicherung', gueltigBis: '2026-10-01' }, HEUTE);
		expect((await listePartner(kA(), { art: 'subunternehmer' }, HEUTE)).find((x) => x.id === p.id)!.warnung).toMatch(/abgelaufen: Betriebshaftpflicht/);
	});

	it('Auftrag: Auftraggeber über die Quelle (automatisch, Handwahl bleibt), Subunternehmer mit Warnung, falsche Art → 400', async () => {
		const ag = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'OBI' });
		const sub = (await listePartner(kA(), { art: 'subunternehmer' }, HEUTE)).find((x) => x.name === 'Elektro Kaya')!;
		const [q] = await root`insert into app.auftrag_quellen (betrieb_id, name) values (${u.betriebA}, 'OBI Anfragen') returning id`;
		await setzeQuellenPartner(kA(), q.id, ag.id);
		const [a] = await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`insert into app.auftraege (betrieb_id, titel, kunde_id, quelle_id) values (${u.betriebA}, 'OBI Bad', ${u.kundeA}, ${q.id}) returning id, auftraggeber_id`);
		expect(a.auftraggeber_id).toBe(ag.id);
		await expect(setzeAuftraggeber(kA(), ALLE(), a.id, sub.id)).rejects.toMatchObject({ status: 400 });
		const w = await fuegeSubunternehmerHinzu(kA(), ALLE(), a.id, sub.id, 'Elektro', HEUTE);
		expect(w).toMatch(/Elektro Kaya: Nachweis abgelaufen/);
		const ap = await auftragPartner(kA(), ALLE(), a.id, false, HEUTE);
		expect(ap).toMatchObject({ auftraggeber: { name: 'OBI' }, subunternehmer: [{ name: 'Elektro Kaya', leistung: 'Elektro' }], fremdleistungen: null });
		// Monteur sieht den Auftrag nicht → 404
		await expect(auftragPartner({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, a.id, false)).rejects.toMatchObject({ status: 404 });
	});

	it('Fremdleistungen: in der Nachkalkulation als Kosten; Auswertung mit Umsatz und Provision; Löschen deaktiviert bei Nutzung', async () => {
		const ag = (await listePartner(kA(), { art: 'auftraggeber' })).find((x) => x.name === 'OBI')!;
		await root`update app.partner set provision_prozent = 10 where id = ${ag.id}`;
		const [a] = await root`select id from app.auftraege where titel = 'OBI Bad' and betrieb_id = ${u.betriebA}`;
		const [an] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${a.id}, 'entwurf', '2099-12-31') returning id`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent) values (${u.betriebA}, ${an.id}, 1, 'Bad', 1, 'Stk', 500000)`;
		await root`update app.angebote set status = 'versendet' where id = ${an.id}`;
		await root`update app.angebote set status = 'angenommen' where id = ${an.id}`;
		const sub = (await listePartner(kA(), { art: 'subunternehmer' }, HEUTE)).find((x) => x.name === 'Elektro Kaya')!;
		await legeFremdleistungAn(kA(), ALLE(), a.id, { bezeichnung: 'Elektroinstallation', betrag: '1.250,00', partnerId: sub.id, rechnungsnummer: 'R-77' });
		await expect(legeFremdleistungAn(kA(), ALLE(), a.id, { bezeichnung: 'x', betrag: '-5' })).rejects.toMatchObject({ status: 400 });
		const nk = await nachkalkulationAuftrag(kA(), a.id, ALLE());
		expect(nk.ist.fremdCent).toBe(125_000);
		expect(nk.ist.deckungsbeitragCent).toBe(500_000 - nk.ist.materialCent - 125_000);
		expect((await auftragPartner(kA(), ALLE(), a.id, true)).summeFremdCent).toBe(125_000);
		expect(await partnerAuswertung(kA(), ag.id, true)).toMatchObject({ auftraegeAlsAuftraggeber: 1, umsatzCent: 500_000, provisionCent: 50_000 });
		expect(await partnerAuswertung(kA(), ag.id, false)).toMatchObject({ umsatzCent: null, provisionCent: null });
		expect(await partnerAuswertung(kA(), sub.id, true)).toMatchObject({ auftraegeAlsSubunternehmer: 1, fremdleistungCent: 125_000 });
		expect(await loeschePartner(kA(), sub.id)).toBe('deaktiviert');
		const frei = await legePartnerAn(kA(), { art: 'lieferant', name: 'Fliesen-Großhandel' });
		expect(await loeschePartner(kA(), frei.id)).toBe('geloescht');
	});
});
