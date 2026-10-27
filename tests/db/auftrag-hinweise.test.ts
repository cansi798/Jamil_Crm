import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { legeAngebotAn, setzeAngebotStatus, speicherePositionen } from '../../src/lib/server/angebote';
import { pruefeNachfassen, setzeNachfassenPausiert, uebernimmStandard, setzeKundeKeinNachfassen } from '../../src/lib/server/nachfassen';
import { holeAuftrag, listeAuftraege } from '../../src/lib/server/auftraege';
import { ladeBoard } from '../../src/lib/server/auftrag-board';
import { listeQuellen, speichereQuelle } from '../../src/lib/server/quellen';
import { load as listenLoad } from '../../src/routes/(app)/auftraege/+page.server';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, type Umgebung } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

/** Abzeichen Angebot/Nachfassen, Filter „Nachfassen fällig“ (msg 2674), Farben der Auftragsquellen (msg 2672). */
describe('Auftrag: Angebot, Nachfassen, Auftragsquelle', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const alle = { alle: true, benutzerId: '' };
	// „heute“ je Test neu bestimmen (nicht beim Laden der Datei – sonst falsch, wenn der Lauf über Mitternacht geht)
	let heute = berlinTag(new Date());
	/** Zeitpunkt vor N Kalendertagen in Berlin (gleiche Uhrzeit) – unabhängig von Sommer-/Winterzeit und Zeitzone der Sitzung */
	const vorBerlinTagen = (tage: number) => root`select ((now() at time zone 'Europe/Berlin') - make_interval(days => ${tage})) at time zone 'Europe/Berlin' as t`.then((z) => z[0].t as Date);

	async function versendet(vorTagen: number) {
		const a = await legeAngebotAn(kA(), u.auftragA);
		await speicherePositionen(kA(), a.id, [{ bezeichnung: 'Fliesen', menge: '10', einheit: 'm²', einzelpreis: '100,00' }]);
		await setzeAngebotStatus(kA(), a.id, 'versendet');
		await root`update app.angebote set versendet_am = ${await vorBerlinTagen(vorTagen)} where id = ${a.id}`;
		return a.id;
	}
	const auftrag = () => holeAuftrag(kA(), { ...alle, benutzerId: u.ids.chefA }, u.auftragA);
	const faellige = async () => (await listeAuftraege(kA(), { ...alle, benutzerId: u.ids.chefA }, { nachfassenFaellig: true })).map((a) => a.id);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		heute = berlinTag(new Date());
		await root`delete from app.todos`;
		await root`delete from app.nachfass_stufen`;
		await root`delete from app.mail_vorlagen`;
		await leereAngebote(root);
		await root`update app.kunden set kein_nachfassen = false`;
	});

	it('ohne Angebot: keine Abzeichen; versendet → „verschickt“ + nächste Stufe; überfällig im Filter; nach Lauf nächste Stufe', async () => {
		await uebernimmStandard(kA()); // Tag 3 Mail, Tag 7 Aufgabe, Tag 14 Mail + Aufgabe
		expect(await auftrag()).toMatchObject({ angebotInfo: null, nachfassenInfo: null });
		const id = await versendet(5);
		const a = await auftrag();
		expect(a.angebotInfo).toEqual({ status: 'versendet', tag: tagPlus(heute, -5) });
		expect(a.nachfassenInfo).toEqual({ tag: tagPlus(heute, -2), pausiert: false }); // Tag 3 noch nicht gelaufen → überfällig
		expect(await faellige()).toEqual([u.auftragA]);

		await pruefeNachfassen(kA()); // Tag 3 läuft: Aufgabe „Nachfass-Mail senden“ (heute) ist offen → heute fällig
		expect((await auftrag()).nachfassenInfo).toEqual({ tag: heute, pausiert: false });
		await root`update app.todos set erledigt_am = now() where nachfass_id is not null`; // Mail gesendet
		expect((await auftrag()).nachfassenInfo).toEqual({ tag: tagPlus(heute, 2), pausiert: false }); // nächste Stufe Tag 7
		expect(await faellige()).toEqual([]);

		// offenes Nachfass-Aufgabe zählt: Tag 7 läuft mit Aufgabe (fällig heute) → heute
		await root`update app.angebote set versendet_am = ${await vorBerlinTagen(7)} where id = ${id}`;
		await pruefeNachfassen(kA());
		expect((await auftrag()).nachfassenInfo?.tag).toBe(heute);
		expect(await faellige()).toEqual([u.auftragA]);

		await setzeNachfassenPausiert(kA(), id, true);
		expect((await auftrag()).nachfassenInfo).toMatchObject({ pausiert: true });
		expect(await faellige()).toEqual([]);

		await setzeAngebotStatus(kA(), id, 'angenommen');
		const b = await auftrag();
		expect(b.angebotInfo).toEqual({ status: 'angenommen', tag: heute });
		expect(b.nachfassenInfo).toBeNull();
	});

	it('Kunde „kein Nachfassen“ → kein Nachfassen; Board liefert dieselben Felder und filtert', async () => {
		await uebernimmStandard(kA());
		await versendet(5);
		const board = await ladeBoard(kA(), { ...alle, benutzerId: u.ids.chefA }, { mitPreisen: false, nachfassenFaellig: true });
		const karte = board.spalten.flatMap((s) => s.karten).find((x) => x.id === u.auftragA)!;
		expect(karte).toMatchObject({ angebotInfo: { status: 'versendet' }, nachfassenInfo: { pausiert: false } });
		expect(board.spalten.flatMap((s) => s.karten)).toHaveLength(1);
		await setzeKundeKeinNachfassen(kA(), u.kundeA, true);
		expect((await auftrag()).nachfassenInfo).toBeNull();
		const leer = await ladeBoard(kA(), { ...alle, benutzerId: u.ids.chefA }, { mitPreisen: false, nachfassenFaellig: true });
		expect(leer.spalten.flatMap((s) => s.karten)).toHaveLength(0);
		const seite = (await listenLoad({ locals: { nutzer: u.chefA }, url: new URL('http://x/auftraege?ansicht=liste&nachfassen=faellig') } as never)) as any;
		expect(seite.nachfassenFaellig).toBe(true);
		expect(seite.auftraege).toEqual([]);
	});

	it('Auftragsquellen: Startliste mit Vorgabefarben, Farbe ändern/prüfen, Farbe am Auftrag', async () => {
		const q = await listeQuellen(kA());
		expect(q.find((x) => x.name === 'Hornbach')?.farbe).toBe('#e8730c');
		const web = q.find((x) => x.name === 'Website')!;
		await speichereQuelle(kA(), web.id, { name: 'Website', aktiv: 'true', farbe: '#FF00AA' });
		expect((await listeQuellen(kA())).find((x) => x.id === web.id)?.farbe).toBe('#ff00aa');
		await speichereQuelle(kA(), web.id, { name: 'Website', aktiv: 'true' }); // ohne Farbe: bleibt
		expect((await listeQuellen(kA())).find((x) => x.id === web.id)?.farbe).toBe('#ff00aa');
		await expect(speichereQuelle(kA(), web.id, { name: 'Website', farbe: 'red;x' })).rejects.toMatchObject({ status: 400 });
		await speichereQuelle(kA(), null, { name: 'Instagram E2E' });
		expect((await listeQuellen(kA())).find((x) => x.name === 'Instagram E2E')?.farbe).toMatch(/^#[0-9a-f]{6}$/);
		await root`update app.auftraege set quelle_id = ${web.id} where id = ${u.auftragA}`;
		expect(await auftrag()).toMatchObject({ quelleName: 'Website', quelleFarbe: '#ff00aa' });
	});

	it('Sprache „Wo muss ich nachfassen?“: Liste der fälligen Aufträge mit Link zum Filter; „pausiere …“ bleibt Pausieren', async () => {
		setzeKiAnbieter(new FakeKi());
		await uebernimmStandard(kA());
		const frage = async (text: string) => (await antwort(await textPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { text }) } as never))).koerper;
		const leer = await frage('Wo muss ich nachfassen?');
		expect(leer.karte.antwort.vorlesen).toBe('Heute ist kein Nachfassen fällig.');
		await versendet(5);
		const r = await frage('Welche Angebote sind zum Nachfassen fällig?');
		expect(r.vorschlag).toBeNull();
		expect(r.karte.aktion).toBe('abfrage_nachfassen');
		expect(r.karte.antwort.abschnitte[0].eintraege[0]).toMatchObject({ link: `/auftraege/${u.auftragA}`, ueberfaellig: true });
		expect(r.karte.antwort.abschnitte[1].eintraege[0].link).toBe('/auftraege?ansicht=liste&nachfassen=faellig');
		expect(r.karte.antwort.vorlesen).toMatch(/^Nachfassen fällig bei 1 Auftrag: Hans Müller\.$/);
		expect((await frage('Pausiere das Nachfassen für Müller')).karte.aktion).toBe('nachfassen_pausieren');
	});
});
