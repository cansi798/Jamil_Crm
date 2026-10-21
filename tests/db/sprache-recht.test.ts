import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { POST as audioPost } from '../../src/routes/api/sprache/+server';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { load as appLayout } from '../../src/routes/(app)/+layout.server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';

/**
 * Recht „Sprachsteuerung nutzen“ (Jamil msg 3011): ohne das Recht kein Mikrofon-Knopf und 403 an allen
 * Sprach-Endpunkten (Aufnahme, getippter Befehl, Ausführen – auch mehrere Schritte), bevor die KI etwas sieht.
 * Standard aus der Migration: Chef und Büro ja, Monteur und andere Rollen nein.
 */
describe('Recht „Sprachsteuerung nutzen“', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let ki: FakeKi;
	const text = async (nutzer: Nutzer, befehl: string) =>
		antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text: befehl }) } as never));
	const ausfuehren = async (nutzer: Nutzer, vorschlag: string) =>
		antwort(await ausfuehrenPost({ locals: { nutzer }, request: jsonAnfrage('POST', { vorschlag }) } as never));

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		ki = new FakeKi();
		setzeKiAnbieter(ki);
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('ohne das Recht: getippter Befehl und Aufnahme → 403, keine KI-Anfrage', async () => {
		const vorher = ki.aufrufe;
		const t = await text(u.monteurOhneSpracheA, 'Neue Aufgabe Material holen');
		expect(t.status).toBe(403);
		expect(t.koerper.fehler).toBe('Die Sprachsteuerung ist für Ihre Rolle nicht freigeschaltet.');
		const a = antwort(
			await audioPost({
				locals: { nutzer: u.monteurOhneSpracheA },
				request: new Request('http://localhost/api/sprache', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(64) })
			} as never)
		);
		expect((await a).status).toBe(403);
		expect(ki.aufrufe).toBe(vorher);
	});

	it('Ausführen ohne das Recht → 403 (einzeln und mehrere Schritte), nichts gespeichert', async () => {
		// Vorschläge entstehen, solange die Rolle das Recht noch hat …
		const einzeln = await text(u.monteurA, 'Hake die Aufgabe Nichts ab');
		expect(einzeln.status).toBe(200);
		const mehrere = await text(u.chefA, 'Leg Kunde Rechtlos an und mach einen Auftrag Dach');
		expect(mehrere.koerper.vorschlag).toBeTruthy();
		// … und das Recht wird danach entzogen
		const chefOhne = { ...u.chefA, rechte: u.chefA.rechte.filter((r) => r !== 'sprache.nutzen') };
		const r = await ausfuehren(chefOhne, mehrere.koerper.vorschlag);
		expect(r.status).toBe(403);
		expect(await root`select 1 from app.kunden where nachname = 'Rechtlos'`).toHaveLength(0);
		const tAlt = await text(u.monteurOhneSpracheA, 'Hake die Aufgabe Nichts ab');
		expect(tAlt.status).toBe(403);
		// Mit dem Recht klappt es weiterhin
		expect((await ausfuehren(u.chefA, mehrere.koerper.vorschlag)).status).toBe(201);
	});

	it('Rechte je Aktion bleiben: Monteur MIT Sprachrecht bekommt bei „Kunde anlegen“ den Hinweis', async () => {
		const r = await text(u.monteurA, 'Neuer Kunde Eva Schulz aus Hamburg');
		expect(r.status).toBe(200);
		expect(r.koerper.vorschlag).toBeNull();
		expect(r.koerper.karte.fehler).toMatch(/Berechtigung/);
	});

	it('Mikrofon-Knopf (App-Hülle) nur mit Modul UND Recht', async () => {
		const laden = async (nutzer: Nutzer) => (await appLayout({ locals: { nutzer }, route: { id: '/(app)' } } as never)) as { sprache: boolean };
		expect((await laden(u.chefA)).sprache).toBe(true);
		expect((await laden(u.monteurA)).sprache).toBe(true);
		expect((await laden(u.monteurOhneSpracheA)).sprache).toBe(false);
	});

	it('Migration: Chef- und Büro-Rollen (und Rollen mit „Einstellungen“) bekommen das Recht, Monteur und andere nicht', async () => {
		const rolle = async (name: string, rechte: string[], vorlage: string | null) =>
			(await root`insert into app.rollen (betrieb_id, name, rechte, vorlage) values (${u.betriebC}, ${name}, ${rechte}, ${vorlage}) returning id`)[0].id as string;
		const ids = {
			chef: await rolle('Chef alt', ['kunden.lesen', 'einstellungen'], 'chef'),
			buero: await rolle('Büro alt', ['kunden.lesen'], 'buero'),
			monteur: await rolle('Monteur alt', ['kunden.lesen'], 'monteur'),
			eigeneAdmin: await rolle('Leitung', ['einstellungen'], null),
			eigene: await rolle('Azubi', ['kunden.lesen'], null)
		};
		await root.unsafe(readFileSync('db/migrations/099_recht_sprache.sql', 'utf8'));
		// zweimal ausführen schadet nicht (kein doppelter Eintrag)
		await root.unsafe(readFileSync('db/migrations/099_recht_sprache.sql', 'utf8'));
		const hat = async (id: string) => {
			const [r] = await root`select rechte from app.rollen where id = ${id}`;
			return (r.rechte as string[]).filter((x) => x === 'sprache.nutzen').length;
		};
		expect(await hat(ids.chef)).toBe(1);
		expect(await hat(ids.buero)).toBe(1);
		expect(await hat(ids.eigeneAdmin)).toBe(1);
		expect(await hat(ids.monteur)).toBe(0);
		expect(await hat(ids.eigene)).toBe(0);
	});
});
