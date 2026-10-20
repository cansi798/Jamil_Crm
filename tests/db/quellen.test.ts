import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { auswertung, listeQuellen, loescheQuelle, speichereQuelle, verschiebeQuelle, START_QUELLEN } from '../../src/lib/server/quellen';
import { aendereAuftrag, legeAuftragAn, listeAuftraege } from '../../src/lib/server/auftraege';
import { legeAngebotAn, setzeAngebotStatus, speicherePositionen } from '../../src/lib/server/angebote';
import { load as auswertungLoad } from '../../src/routes/(app)/auswertung/quellen/+page.server';
import { actions as neuAktionen } from '../../src/routes/(app)/auftraege/neu/+page.server';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { berlinTag } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, type Umgebung } from './hilfe-1c';

/** Auftragsquellen und Auswertung (Jamil msg 2593). */
describe('Auftragsquellen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const heute = berlinTag(new Date());

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		setzeKiAnbieter(new FakeKi());
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await leereAngebote(root);
		await root`update app.auftraege set quelle_id = null`;
		await root`delete from app.auftraege where titel like 'Q-%'`;
	});

	it('Startliste beim ersten Lesen; eigene Quelle, Reihenfolge, Name eindeutig; Betrieb B getrennt', async () => {
		expect((await listeQuellen(kA())).map((q) => q.name)).toEqual(START_QUELLEN);
		await speichereQuelle(kA(), null, { name: 'Instagram' });
		await expect(speichereQuelle(kA(), null, { name: ' instagram ' })).rejects.toMatchObject({ status: 409 });
		const insta = (await listeQuellen(kA())).find((q) => q.name === 'Instagram')!;
		await verschiebeQuelle(kA(), insta.id, -1);
		expect((await listeQuellen(kA())).map((q) => q.name).slice(-2)).toEqual(['Instagram', 'Sonstiges']);
		expect(await loescheQuelle(kA(), insta.id)).toBe('geloescht');
		expect((await listeQuellen(kB())).map((q) => q.name)).toEqual(START_QUELLEN);
		await expect(loescheQuelle(kB(), insta.id)).rejects.toMatchObject({ status: 404 });
	});

	it('Auftrag mit Quelle; fremde Quelle → 400; Filter; Pflicht im Formular „Neuer Auftrag“; benutzte Quelle wird nur ausgeschaltet', async () => {
		const [hornbach] = (await listeQuellen(kA())).filter((q) => q.name === 'Hornbach');
		const fremd = (await listeQuellen(kB()))[0];
		const a = await legeAuftragAn(kA(), { titel: 'Q-1', kundeId: u.kundeA, quelleId: hornbach.id });
		expect(a).toMatchObject({ quelleId: hornbach.id, quelleName: 'Hornbach' });
		await expect(legeAuftragAn(kA(), { titel: 'Q-x', kundeId: u.kundeA, quelleId: fremd.id })).rejects.toMatchObject({ status: 400 });
		expect((await listeAuftraege(kA(), { alle: true, benutzerId: u.ids.chefA }, { quelleId: hornbach.id })).map((x) => x.titel)).toEqual(['Q-1']);
		expect((await aendereAuftrag(kA(), a.id, { titel: 'Q-1b' })).quelleId).toBe(hornbach.id);
		const ohne = (await neuAktionen.anlegen({
			locals: { nutzer: u.chefA },
			request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams({ titel: 'Q-2', kundeId: u.kundeA }) })
		} as never)) as any;
		expect(ohne.status).toBe(400);
		expect(ohne.data.fehler).toMatch(/Auftragsquelle/);
		expect(await loescheQuelle(kA(), hornbach.id)).toBe('deaktiviert');
		await speichereQuelle(kA(), hornbach.id, { name: 'Hornbach', aktiv: 'true' });
	});

	it('Auswertung: Aufträge, Angebote, angenommen, Quote, Umsatz (netto) und Ø je Quelle; Seite nur Chef', async () => {
		const qs = await listeQuellen(kA());
		const web = qs.find((q) => q.name === 'Website')!;
		const a1 = await legeAuftragAn(kA(), { titel: 'Q-web1', kundeId: u.kundeA, quelleId: web.id });
		const a2 = await legeAuftragAn(kA(), { titel: 'Q-web2', kundeId: u.kundeA, quelleId: web.id });
		await legeAuftragAn(kA(), { titel: 'Q-ohne', kundeId: u.kundeA });
		const angebot = async (auftragId: string, euro: string, status: 'angenommen' | 'abgelehnt' | 'versendet') => {
			const an = await legeAngebotAn(kA(), auftragId);
			await speicherePositionen(kA(), an.id, [{ bezeichnung: 'x', menge: '1', einheit: 'Stk', einzelpreis: euro }]);
			await setzeAngebotStatus(kA(), an.id, 'versendet');
			if (status !== 'versendet') await setzeAngebotStatus(kA(), an.id, status);
		};
		await angebot(a1.id, '1.000,00', 'angenommen');
		await angebot(a2.id, '500,00', 'abgelehnt');
		const z = await auswertung(kA(), heute, heute);
		expect(z.find((r) => r.name === 'Website')).toMatchObject({
			auftraege: 2,
			angebote: 2,
			angenommen: 1,
			quoteProzent: 50,
			umsatzCent: 100000,
			durchschnittCent: 100000
		});
		expect(z.find((r) => r.name === 'Ohne Auftragsquelle')!.auftraege).toBeGreaterThanOrEqual(1);
		await expect(auswertung(kA(), heute, '2000-01-01')).rejects.toMatchObject({ status: 400 });
		const url = new URL(`http://localhost/auswertung/quellen?von=${heute}&bis=${heute}`);
		const chef = (await auswertungLoad({ locals: { nutzer: u.chefA }, url } as never)) as any;
		expect(chef.zeilen.find((r: any) => r.name === 'Website').umsatzCent).toBe(100000);
		await expect(auswertungLoad({ locals: { nutzer: u.bueroA }, url } as never)).rejects.toMatchObject({ status: 403 });
	});

	it('Sprache: Quelle beim Anlegen und „Setze die Quelle vom Auftrag … auf …“', async () => {
		const sag = async (befehl: string) => {
			const r = antwort(await textPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { text: befehl }) } as never));
			const k = await r;
			expect(k.koerper.karte.fehler, JSON.stringify(k.koerper.karte)).toBeNull();
			const a = await antwort(await ausfuehrenPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { vorschlag: k.koerper.vorschlag }) } as never));
			expect(a.status).toBeLessThan(300);
			return { karte: k.koerper.karte, meldung: a.koerper.meldung as string };
		};
		const r = await sag('Neuer Auftrag Q-Dach bei Müller, kam über Hornbach');
		expect(r.karte.zeilen).toContainEqual({ label: 'Auftragsquelle', wert: 'Hornbach' });
		const [neu] = await root`select q.name from app.auftraege a join app.auftrag_quellen q on q.id = a.quelle_id where a.titel = 'Q-Dach'`;
		expect(neu.name).toBe('Hornbach');
		const s = await sag('Setze die Quelle vom Auftrag Q-Dach auf Empfehlung');
		expect(s.meldung).toMatch(/Auftragsquelle von A-.*: Empfehlung/);
	});
});
