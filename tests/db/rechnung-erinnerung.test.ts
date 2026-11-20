import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { setzeStatus } from '../../src/lib/server/auftraege';
import { berlinTag, werktagePlus } from '../../src/lib/zeit';
import { aendereTodo } from '../../src/lib/server/todos';
import { ladeErinnerungEinstellung, speichereErinnerungEinstellung } from '../../src/lib/server/rechnung-erinnerung';
import { load as seiteLaden, actions as seitenAktionen } from '../../src/routes/(app)/einstellungen/rechnung-erinnerung/+page.server';

/** Abgenommen → nur Erinnerung „Rechnung erstellen“, kein Rechnungsentwurf (Jamil msg 6525/6527). */
describe('Rechnungs-Erinnerung bei Abnahme', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kChef = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const aufgaben = (auftragId: string) =>
		root`select id, titel, beschreibung, zustaendig_id, to_char(faellig, 'YYYY-MM-DD') as faellig, erledigt_am from app.todos
			where auftrag_id = ${auftragId} and titel like 'Rechnung für Auftrag %' order by angelegt`;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('In Arbeit → Abgenommen: genau eine Aufgabe fürs Büro, fällig in 2 Werktagen, mit Glocke und Link', async () => {
		const id = await u.neuerAuftrag('in_arbeit', 'Bad fertig');
		const [{ nummer }] = await root`select nummer from app.auftraege where id = ${id}`;
		const a = await setzeStatus(kChef(), id, 'abgenommen');
		expect(a.status).toBe('abgenommen');
		const t = await aufgaben(id);
		expect(t).toHaveLength(1);
		expect(t[0].titel).toBe(`Rechnung für Auftrag ${nummer} erstellen`);
		expect(t[0].zustaendig_id).toBe(u.ids.bueroA);
		expect(t[0].faellig).toBe(werktagePlus(berlinTag(new Date()), 2));
		expect(t[0].beschreibung).toContain('noch keine Rechnung');
		const er = await root`select benutzer_id, link, gesendet_am from app.erinnerungen where todo_id = ${t[0].id}`;
		expect(er).toHaveLength(1);
		expect(er[0]).toMatchObject({ benutzer_id: u.ids.bueroA, link: `/auftraege/${id}` });
		expect(er[0].gesendet_am).not.toBeNull();
	});

	it('kein Rechnungsentwurf: weder Rechnung noch Lexware-Auftrag entsteht', async () => {
		const id = await u.neuerAuftrag('in_arbeit', 'Ohne Entwurf');
		await setzeStatus(kChef(), id, 'abgenommen');
		expect(await root`select 1 from app.rechnungen where auftrag_id = ${id}`).toHaveLength(0);
		expect(await root`select 1 from app.lexware_auftraege where art like 'rechnung%' and nutzlast::text like ${'%' + id + '%'}`).toHaveLength(0);
	});

	it('idempotent: zurück und wieder Abgenommen, auch wenn die Aufgabe erledigt ist → keine zweite', async () => {
		const id = await u.neuerAuftrag('in_arbeit', 'Hin und her');
		await setzeStatus(kChef(), id, 'abgenommen');
		await setzeStatus(kChef(), id, 'in_arbeit');
		await setzeStatus(kChef(), id, 'abgenommen');
		expect(await aufgaben(id)).toHaveLength(1);
		await root`update app.todos set erledigt_am = now() where auftrag_id = ${id}`;
		await setzeStatus(kChef(), id, 'in_arbeit');
		await setzeStatus(kChef(), id, 'abgenommen', undefined, { sprung: true });
		expect(await aufgaben(id)).toHaveLength(1);
	});

	it('andere Wechsel (Beauftragt → In Arbeit, Abgenommen → Abgerechnet) legen keine Erinnerung an', async () => {
		const id = await u.neuerAuftrag('beauftragt', 'Nur Arbeit');
		await setzeStatus(kChef(), id, 'in_arbeit');
		expect(await aufgaben(id)).toHaveLength(0);
		const id2 = await u.neuerAuftrag('abgenommen', 'Schon abgenommen');
		await setzeStatus(kChef(), id2, 'abgerechnet');
		expect(await aufgaben(id2)).toHaveLength(0);
	});

	it('ohne Büro-Rolle bekommt der Chef die Erinnerung', async () => {
		await root`update app.benutzer set aktiv = false where id = ${u.ids.bueroA}`;
		try {
			const id = await u.neuerAuftrag('in_arbeit', 'Nur Chef');
			await setzeStatus(kChef(), id, 'abgenommen');
			const t = await aufgaben(id);
			expect(t).toHaveLength(1);
			expect(t[0].zustaendig_id).toBe(u.ids.chefA);
		} finally {
			await root`update app.benutzer set aktiv = true where id = ${u.ids.bueroA}`;
		}
	});
	describe('Zuweisung selbst bestimmen (Jamil msg 6530)', () => {
		const zurueck = () => root`delete from app.rechnung_erinnerung_einstellung where betrieb_id = ${u.betriebA}`;

		it('Standard ohne Einstellung; feste Person; Rolle; ungültige Eingaben → 400', async () => {
			await zurueck();
			expect(await ladeErinnerungEinstellung(kChef())).toEqual({ zuweisung: 'standard', benutzerId: null, rolleId: null });

			await speichereErinnerungEinstellung(kChef(), { zuweisung: 'person', benutzerId: u.ids.chefA });
			let id = await u.neuerAuftrag('in_arbeit', 'Feste Person');
			await setzeStatus(kChef(), id, 'abgenommen');
			expect((await aufgaben(id))[0].zustaendig_id).toBe(u.ids.chefA);

			const [{ rolle_id }] = await root`select rolle_id from app.benutzer where id = ${u.ids.monteurA}`;
			expect(await speichereErinnerungEinstellung(kChef(), { zuweisung: 'rolle', rolleId: rolle_id })).toEqual({ zuweisung: 'rolle', benutzerId: null, rolleId: rolle_id });
			id = await u.neuerAuftrag('in_arbeit', 'Rolle');
			await setzeStatus(kChef(), id, 'abgenommen');
			expect((await aufgaben(id))[0].zustaendig_id).toBe(u.ids.monteurA);

			await expect(speichereErinnerungEinstellung(kChef(), { zuweisung: 'person' })).rejects.toMatchObject({ status: 400 });
			await expect(speichereErinnerungEinstellung(kChef(), { zuweisung: 'egal' })).rejects.toMatchObject({ status: 400 });
			await expect(speichereErinnerungEinstellung(kChef(), { zuweisung: 'person', benutzerId: u.ids.chefB })).rejects.toMatchObject({ status: 400 });
			await zurueck();
		});

		it('gewählte Person nicht mehr aktiv → Standard (Büro)', async () => {
			await speichereErinnerungEinstellung(kChef(), { zuweisung: 'person', benutzerId: u.ids.ohnePreiseA });
			await root`update app.benutzer set aktiv = false where id = ${u.ids.ohnePreiseA}`;
			try {
				const id = await u.neuerAuftrag('in_arbeit', 'Inaktiv');
				await setzeStatus(kChef(), id, 'abgenommen');
				expect((await aufgaben(id))[0].zustaendig_id).toBe(u.ids.bueroA);
			} finally {
				await root`update app.benutzer set aktiv = true where id = ${u.ids.ohnePreiseA}`;
				await zurueck();
			}
		});

		it('Einstellung je Betrieb (RLS): Betrieb B sieht A nicht', async () => {
			await speichereErinnerungEinstellung(kChef(), { zuweisung: 'person', benutzerId: u.ids.chefA });
			expect((await ladeErinnerungEinstellung({ betriebId: u.betriebB, benutzerId: u.ids.chefB })).zuweisung).toBe('standard');
			await zurueck();
		});

		it('Seite: nur mit „Einstellungen“; Speichern über die Aktion', async () => {
			await expect(seiteLaden({ locals: { nutzer: u.monteurA } } as never)).rejects.toMatchObject({ status: 403 });
			const d = (await seiteLaden({ locals: { nutzer: u.chefA } } as never)) as { einstellung: { zuweisung: string }; mitarbeiter: unknown[]; rollen: unknown[] };
			expect(d.einstellung.zuweisung).toBe('standard');
			expect(d.mitarbeiter.length).toBeGreaterThan(0);
			const f = new FormData();
			f.set('zuweisung', 'person');
			f.set('benutzerId', u.ids.chefA);
			const r = await seitenAktionen.speichern({ locals: { nutzer: u.chefA }, request: new Request('http://x', { method: 'POST', body: f }) } as never);
			expect(r).toEqual({ gespeichert: true });
			expect((await ladeErinnerungEinstellung(kChef())).benutzerId).toBe(u.ids.chefA);
			await zurueck();
		});

		it('die erzeugte Erinnerung lässt sich wie jede Aufgabe umweisen', async () => {
			const id = await u.neuerAuftrag('in_arbeit', 'Umweisen');
			await setzeStatus(kChef(), id, 'abgenommen');
			const [t] = await aufgaben(id);
			await aendereTodo(kChef(), t.id, { zustaendigId: u.ids.chefA });
			expect((await aufgaben(id))[0].zustaendig_id).toBe(u.ids.chefA);
		});
	});
});
