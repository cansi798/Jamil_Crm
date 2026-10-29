import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mitBetriebOeffentlich, schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { aendereTodo, legeTodoAn, loescheTodo } from '../../src/lib/server/todos';
import { aendereEinsatz, legeEinsatzAn, legeGruppeAn, loescheEinsatz } from '../../src/lib/server/plantafel';
import { aendereAuftrag, legeAuftragAn, setzeStatus } from '../../src/lib/server/auftraege';
import {
	benachrichtigungen,
	ladeBenachrichtigungsWahl,
	markiereGelesen,
	speichereBenachrichtigungsWahl,
	stelleBenachrichtigungenZu
} from '../../src/lib/server/erinnerungen';

/** Benachrichtigungen, wenn einen etwas betrifft (Jamil msg 3734, Migration 114). */
describe('Benachrichtigungen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kChef = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kMonteur = () => ({ betriebId: u.betriebA, benutzerId: u.ids.monteurA });
	const kBuero = () => ({ betriebId: u.betriebA, benutzerId: u.ids.bueroA });
	const vonMonteur = async () =>
		root`select kategorie, titel, text, link, anzahl, push_ergebnis, gelesen_am from app.benachrichtigungen where benutzer_id = ${u.ids.monteurA} order by angelegt`;
	const leeren = () => root`delete from app.benachrichtigungen where betrieb_id = ${u.betriebA}`;
	const morgen = (std: number) => new Date(Date.now() + 86_400_000 + std * 3_600_000).toISOString();

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Aufgabe: A weist B zu → B bekommt eine Nachricht, A nicht; sich selbst zuweisen → keine', async () => {
		await leeren();
		const t = await legeTodoAn(kChef(), { titel: 'BN Silikon kaufen', zustaendigId: u.ids.monteurA, auftragId: u.auftragA, faellig: '2026-12-01' });
		const n = await vonMonteur();
		expect(n).toHaveLength(1);
		expect(n[0]).toMatchObject({ kategorie: 'aufgabe', titel: 'Neue Aufgabe für dich: BN Silikon kaufen', link: `/auftraege/${u.auftragA}` });
		expect(n[0].text).toContain('von ');
		expect(n[0].text).toContain('fällig 01.12.2026');
		expect(await root`select 1 from app.benachrichtigungen where benutzer_id = ${u.ids.chefA}`).toHaveLength(0);
		// Speichern ohne Änderung der Personen: keine zweite Nachricht
		await aendereTodo(kChef(), t.id, { titel: 'BN Silikon kaufen (2)', zustaendigId: u.ids.monteurA });
		expect(await vonMonteur()).toHaveLength(1);
		await legeTodoAn(kMonteur(), { titel: 'BN Eigene', zustaendigId: u.ids.monteurA });
		expect(await vonMonteur()).toHaveLength(1);
		// Aufgabe gelöscht → ihre Nachricht verschwindet
		await loescheTodo(kChef(), t.id);
		expect(await vonMonteur()).toHaveLength(0);
	});

	it('Termin: eingeteilt, verschoben (gebündelt), umgehängt, gelöscht', async () => {
		await leeren();
		const e = await legeEinsatzAn(kChef(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: morgen(0), ende: morgen(2) });
		let n = await vonMonteur();
		expect(n).toHaveLength(1);
		expect(n[0].titel).toMatch(/^Neuer Termin für dich: A-/);
		// verschieben innerhalb von 15 Minuten → dieselbe Nachricht, Anzahl 2
		await aendereEinsatz(kChef(), e.id, { beginn: morgen(3), ende: morgen(5) });
		n = await vonMonteur();
		expect(n).toHaveLength(1);
		expect(n[0]).toMatchObject({ anzahl: 2 });
		expect(n[0].titel).toMatch(/^Termin verschoben: /);
		expect(n[0].text).toMatch(/^jetzt /);
		// gelesen → nächste Änderung ist eine neue Nachricht
		await markiereGelesen(kMonteur(), undefined);
		await aendereEinsatz(kChef(), e.id, { benutzerId: u.ids.bueroA });
		n = await vonMonteur();
		expect(n.at(-1)!.titel).toMatch(/^Du bist aus einem Termin ausgetragen: /);
		expect((await root`select titel from app.benachrichtigungen where benutzer_id = ${u.ids.bueroA}`)[0].titel).toMatch(/^Neuer Termin für dich/);
		await loescheEinsatz(kChef(), e.id);
		const buero = await root`select titel, link from app.benachrichtigungen where benutzer_id = ${u.ids.bueroA} order by aktualisiert desc`;
		expect(buero[0].titel).toMatch(/^Termin abgesagt: /);
		expect(buero[0].link).toMatch(/^\/plantafel\?ansicht=tag&tag=\d{4}-\d{2}-\d{2}$/);
	});

	it('mehrtägiger Termin = eine Nachricht mit Anzahl', async () => {
		await leeren();
		await legeGruppeAn(kChef(), { auftragId: u.auftragA, benutzerIds: [u.ids.monteurA], vonTag: '2026-11-16', bisTag: '2026-11-18' });
		const n = await vonMonteur();
		expect(n).toHaveLength(1);
		expect(n[0].anzahl).toBe(3);
	});

	it('Auftrag: zuständig eingetragen (nur neu Hinzugekommene), Statuswechsel an alle Zuständigen außer dem Auslöser', async () => {
		await leeren();
		const a = await legeAuftragAn(kChef(), { titel: 'BN Bad', kundeId: u.kundeA, zustaendige: [u.ids.monteurA, u.ids.chefA] });
		expect((await vonMonteur()).map((x) => x.titel)).toEqual([`Auftrag für dich: ${a.nummer} BN Bad`]);
		await aendereAuftrag(kChef(), a.id, { titel: 'BN Bad', kundeId: u.kundeA, zustaendige: [u.ids.monteurA, u.ids.chefA, u.ids.bueroA] });
		expect(await vonMonteur()).toHaveLength(1);
		expect(await root`select 1 from app.benachrichtigungen where benutzer_id = ${u.ids.bueroA}`).toHaveLength(1);
		await markiereGelesen(kMonteur(), undefined);
		await setzeStatus(kChef(), a.id, 'angebot');
		const n = await vonMonteur();
		expect(n.at(-1)!.titel).toBe(`Auftrag ${a.nummer} ist jetzt „Angebot“`);
		expect(await root`select 1 from app.benachrichtigungen where benutzer_id = ${u.ids.chefA}`).toHaveLength(0);
	});

	it('Glocke zeigt Erinnerungen und Benachrichtigungen zusammen; gelesen markieren', async () => {
		await leeren();
		await legeTodoAn(kChef(), { titel: 'BN Glocke', zustaendigId: u.ids.monteurA });
		const g = await benachrichtigungen(kMonteur());
		expect(g.ungelesen).toBeGreaterThanOrEqual(1);
		const eintrag = g.liste.find((x) => x.titel === 'Neue Aufgabe für dich: BN Glocke')!;
		expect(eintrag.gelesen).toBe(false);
		await markiereGelesen(kMonteur(), eintrag.id);
		expect((await benachrichtigungen(kMonteur())).liste.find((x) => x.id === eintrag.id)!.gelesen).toBe(true);
		// fremder Betrieb sieht nichts
		expect((await benachrichtigungen({ betriebId: u.betriebB, benutzerId: u.ids.chefB })).liste.some((x) => x.id === eintrag.id)).toBe(false);
	});

	it('Einstellungen je Kategorie: Glocke aus = nichts, Push aus = nur Glocke; Protokoll', async () => {
		await leeren();
		expect(await ladeBenachrichtigungsWahl(kMonteur())).toEqual({ aufgabe: { glocke: true, push: true }, termin: { glocke: true, push: true }, auftrag: { glocke: true, push: true } });
		await speichereBenachrichtigungsWahl(kMonteur(), { aufgabe: { glocke: false, push: true }, termin: { glocke: true, push: false } });
		expect(await ladeBenachrichtigungsWahl(kMonteur())).toMatchObject({ aufgabe: { glocke: false, push: false }, termin: { glocke: true, push: false } });
		await legeTodoAn(kChef(), { titel: 'BN still', zustaendigId: u.ids.monteurA });
		await legeEinsatzAn(kChef(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: morgen(6), ende: morgen(7) });
		const n = await vonMonteur();
		expect(n.map((x) => [x.kategorie, x.push_ergebnis])).toEqual([['termin', 'aus']]);
		expect(await root`select 1 from app.aenderungen where tabelle = 'benachrichtigung_einstellungen'`).not.toHaveLength(0);
		await speichereBenachrichtigungsWahl(kMonteur(), { aufgabe: { glocke: true, push: true }, termin: { glocke: true, push: true } });
	});

	it('öffentliche Abläufe und Systemkontext ohne Benutzer', async () => {
		await leeren();
		// Online-Buchung/Portal (öffentlich) melden selbst – hier nichts
		await mitBetriebOeffentlich(u.betriebA, (tx) =>
			tx`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende) values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, ${morgen(8)}, ${morgen(9)})`
		);
		expect(await vonMonteur()).toHaveLength(0);
		// ohne angemeldeten Auslöser (z. B. Hintergrund-Dienst) → Nachricht, ohne „von …“
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende) values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, ${morgen(10)}, ${morgen(11)})`;
		const n = await vonMonteur();
		expect(n).toHaveLength(1);
		expect(n[0].text).not.toContain('von ');
	});

	it('Push-Zustellung markiert jede Nachricht genau einmal', async () => {
		await leeren();
		await legeTodoAn(kBuero(), { titel: 'BN Push', zustaendigId: u.ids.monteurA });
		const r = await stelleBenachrichtigungenZu();
		expect(r.gesendet + r.ohne).toBeGreaterThanOrEqual(1);
		expect((await vonMonteur())[0].push_ergebnis).toBe('gesendet');
		const r2 = await stelleBenachrichtigungenZu();
		expect(r2.gesendet).toBe(0);
	});
});
