import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { legeAngebotAn, setzeAngebotStatus, speicherePositionen } from '../../src/lib/server/angebote';
import { legeTodoAn } from '../../src/lib/server/todos';
import { berlinTag } from '../../src/lib/zeit';
import { speichereKolonne } from '../../src/lib/server/kolonnen';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, type Umgebung } from './hilfe-1c';

/** Neue Sprachaktionen (Jamil msgs 2645/2647): Vorschlag → Bestätigung → Ausführen; Frage ohne Bestätigung. */
describe('Sprache – neue Aktionen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const text = async (nutzer: Nutzer, befehl: string) =>
		antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text: befehl }) } as never));
	const ausfuehren = async (nutzer: Nutzer, vorschlag: string, auswahl?: Record<string, string>) =>
		antwort(await ausfuehrenPost({ locals: { nutzer }, request: jsonAnfrage('POST', { vorschlag, ...(auswahl ? { auswahl } : {}) }) } as never));
	/** Befehl sprechen und bestätigen; liefert die Antwort des Ausführens. */
	const sagUndBestaetige = async (nutzer: Nutzer, befehl: string) => {
		const r = await text(nutzer, befehl);
		expect(r.status, JSON.stringify(r.koerper)).toBe(200);
		expect(r.koerper.karte.fehler, JSON.stringify(r.koerper.karte)).toBeNull();
		expect(r.koerper.vorschlag).toBeTruthy();
		const a = await ausfuehren(nutzer, r.koerper.vorschlag);
		expect(a.status, JSON.stringify(a.koerper)).toBeLessThan(300);
		return a.koerper;
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		setzeKiAnbieter(new FakeKi());
		await root`delete from app.todos`;
		await leereAngebote(root);
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Mitarbeiter zuweisen (dazu, nicht ersetzen)', async () => {
		const r = await sagUndBestaetige(u.chefA, 'Weise Ali Monteur dem Auftrag Badsanierung zu');
		expect(r.meldung).toMatch(/Zuständig für .*Ali Monteur/);
		const z = await root`select benutzer_id from app.auftrag_zustaendige where auftrag_id = ${u.auftragA}`;
		expect(z.map((x) => x.benutzer_id)).toContain(u.ids.monteurA);
	});

	it('Status: auf eine Station springen; Monteur darf das nicht (Karte mit Hinweis, kein Vorschlag)', async () => {
		await root`update app.auftraege set status = 'anfrage' where id = ${u.auftragA}`;
		const r = await sagUndBestaetige(u.chefA, 'Setze Auftrag Badsanierung auf beauftragt');
		expect(r.meldung).toMatch(/„Beauftragt“/);
		const m = await text(u.monteurA, 'Setze Auftrag Badsanierung auf in Arbeit');
		expect(m.koerper.vorschlag).toBeNull();
		expect(m.koerper.karte.fehler).toMatch(/Berechtigung/);
	});

	it('Wiederkehrende Aufgabe anlegen und per Sprache abhaken (nächste Instanz entsteht)', async () => {
		const r = await sagUndBestaetige(u.chefA, 'Neue Aufgabe: Filter wechseln jede Woche');
		expect(r.meldung).toMatch(/Wiederkehrende Aufgabe „Filter wechseln“ angelegt \(wöchentlich\)/);
		const h = await sagUndBestaetige(u.chefA, 'Hake die Aufgabe Filter wechseln ab');
		expect(h.meldung).toBe('Aufgabe „Filter wechseln“ erledigt');
		const t = await root`select erledigt_am is not null as erledigt from app.todos where titel = 'Filter wechseln' order by faellig`;
		expect(t.map((x) => x.erledigt)).toEqual([true, false]);
	});

	it('Anlage beim einzigen Objekt des Kunden anlegen', async () => {
		const r = await sagUndBestaetige(u.chefA, 'Neue Wärmepumpe bei Müller, Hersteller Vaillant, Wartung jährlich');
		expect(r.meldung).toMatch(/Anlage „Wärmepumpe“ angelegt/);
		const [an] = await root`select typ, hersteller, wartung_regel, objekt_id from app.anlagen where hersteller = 'Vaillant'`;
		expect(an).toMatchObject({ typ: 'waermepumpe', wartung_regel: 'jaehrlich', objekt_id: u.objektA });
	});

	it('Nachfassen pausieren und fortsetzen', async () => {
		const a = await legeAngebotAn(kA(), u.auftragA);
		await speicherePositionen(kA(), a.id, [{ bezeichnung: 'x', menge: '1', einheit: 'Stk', einzelpreis: '10,00' }]);
		await setzeAngebotStatus(kA(), a.id, 'versendet');
		await sagUndBestaetige(u.chefA, `Nachfassen für Angebot ${a.nummer} pausieren`);
		expect((await root`select nachfassen_pausiert from app.angebote where id = ${a.id}`)[0].nachfassen_pausiert).toBe(true);
		await sagUndBestaetige(u.chefA, 'Nachfassen bei Müller wieder fortsetzen');
		expect((await root`select nachfassen_pausiert from app.angebote where id = ${a.id}`)[0].nachfassen_pausiert).toBe(false);
	});

	it('Kolonne: mehrtägig einplanen, dem Auftrag zuweisen, Plan der Kolonne abfragen', async () => {
		await root`delete from app.einsaetze`;
		await root`delete from app.kolonnen`;
		await speichereKolonne(kA(), null, { name: 'Kolonne A', mitglieder: [u.ids.monteurA, u.ids.bueroA] });
		const r = await sagUndBestaetige(u.chefA, 'Plane Kolonne A bei Müller von Montag bis Mittwoch ein');
		expect(r.meldung).toBe('Termin an 3 Tagen eingeplant (6 Einsätze)');
		expect((await root`select count(distinct gruppe_id)::int as n from app.einsaetze`)[0].n).toBe(1);
		await sagUndBestaetige(u.chefA, 'Weise Kolonne A dem Auftrag Badsanierung zu');
		const z = await root`select benutzer_id from app.auftrag_zustaendige where auftrag_id = ${u.auftragA}`;
		expect(z.map((x) => x.benutzer_id)).toEqual(expect.arrayContaining([u.ids.monteurA, u.ids.bueroA]));
		const plan = await text(u.monteurA, 'Was hat Kolonne A diese Woche?');
		expect(plan.koerper.karte.fehler).toBeNull();
		expect(plan.koerper.karte.titel).toBe('Tagesplan diese Woche – Kolonne A');
		const fremd = await text({ ...u.nurAngeboteA, rechte: [...u.nurAngeboteA.rechte, 'sprache.nutzen'] }, 'Was hat Kolonne A diese Woche?'); // kein Mitglied, ohne „Alle Aufgaben ansehen“
		expect(fremd.koerper.karte.fehler ?? '').toMatch(/eigenen Tagesplan|Berechtigung/);
	});

	it('Frage „Was steht heute an?“: Antwort ohne Bestätigung; Monteur nur über sich selbst', async () => {
		await legeTodoAn(kA(), { titel: 'Material holen', zustaendigId: u.ids.monteurA, faellig: berlinTag(new Date()), auftragId: u.auftragA });
		const r = await text(u.monteurA, 'Was steht heute für mich an?');
		expect(r.koerper.vorschlag).toBeNull();
		expect(r.koerper.karte).toMatchObject({ aktion: 'abfrage_tagesplan', fehler: null });
		const todos = r.koerper.karte.antwort.abschnitte.find((a: any) => a.titel === 'Aufgaben');
		expect(todos.eintraege.map((e: any) => e.titel)).toContain('Material holen');
		expect(r.koerper.karte.antwort.vorlesen).toMatch(/^Du hast heute/);
		// Monteur fragt nach dem Chef → nicht erlaubt
		const fremd = await text(u.monteurA, 'Was hat Chef morgen?');
		expect(fremd.koerper.karte.fehler).toMatch(/nur Ihren eigenen/);
		// Chef darf nach Ali fragen
		const chef = await text(u.chefA, 'Was hat Ali heute?');
		expect(chef.koerper.karte.fehler).toBeNull();
		expect(chef.koerper.karte.titel).toBe('Tagesplan heute – Ali Monteur');
	});
});
