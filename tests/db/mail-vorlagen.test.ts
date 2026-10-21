import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import {
	kopiereMailVorlage,
	listeMailVorlagen,
	loescheMailVorlage,
	mailVorbereitung,
	setzeStandard,
	speichereMailVorlage,
	speichereSignatur,
	vorlagenZugriff
} from '../../src/lib/server/mail-vorlagen';
import { abMitVorlage, beiAngebotAngenommen } from '../../src/lib/server/auftragsbestaetigung';
import { setzeMailVersand } from '../../src/lib/server/nachfassen';
import { MAIL_ZWECKE } from '../../src/lib/mail-vorlagen';
import { actions, load } from '../../src/routes/(app)/einstellungen/mail-vorlagen/+page.server';

/** E-Mail-Vorlagen an einem Ort (Jamil msg 2789): Standards je Zweck, Rechte, Auftragsbestätigung, Mail an Kunden. */
describe('E-Mail-Vorlagen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await root`delete from app.nachfass_stufen where betrieb_id in (${u.betriebA}, ${u.betriebB})`;
		await root`delete from app.mail_vorlagen where betrieb_id in (${u.betriebA}, ${u.betriebB})`;
		await root`update app.kunden set email = 'mueller@kunde.test', anrede = 'Herr', nachname = 'Müller', art = 'privat' where id = ${u.kundeA}`;
	});
	afterAll(async () => {
		setzeMailVersand(null);
		await schliesseDb();
		await root?.end();
	});

	it('je Zweck genau ein Standard – angelegt beim ersten Bedarf, auch bei gleichzeitigen Aufrufen', async () => {
		await Promise.all([listeMailVorlagen(kA()), listeMailVorlagen(kA()), listeMailVorlagen(kA())]);
		const l = await listeMailVorlagen(kA());
		expect(l.filter((v) => v.istStandard).map((v) => v.zweck).sort()).toEqual([...MAIL_ZWECKE].sort());
		expect(l).toHaveLength(MAIL_ZWECKE.length);
		// Betrieb B sieht nichts von A
		const b = await listeMailVorlagen(kB());
		expect(b.map((v) => v.id).some((id) => l.some((x) => x.id === id))).toBe(false);
	});

	it('anlegen, Standard wechseln, Zweck wechseln, kopieren, löschen – immer genau ein Standard', async () => {
		const v = await speichereMailVorlage(kA(), null, { name: 'AB kurz', zweck: 'auftragsbestaetigung', betreff: 'AB {{ab.nummer}}', html: '<p>{{kunde.anrede}} {{termin}}</p>' });
		expect(v).toMatchObject({ istStandard: false, unbekannt: ['termin'] });
		await setzeStandard(kA(), v.id);
		const ab = (await listeMailVorlagen(kA(), 'auftragsbestaetigung')).filter((x) => x.istStandard);
		expect(ab.map((x) => x.id)).toEqual([v.id]);
		// Zweck wechseln: der alte Zweck bekommt wieder einen Standard
		await speichereMailVorlage(kA(), v.id, { name: 'AB kurz', zweck: 'allgemein', betreff: 'x', html: '<p>x</p>' });
		expect((await listeMailVorlagen(kA(), 'auftragsbestaetigung')).filter((x) => x.istStandard)).toHaveLength(1);
		const kopie = await kopiereMailVorlage(kA(), v.id);
		expect(kopie).toMatchObject({ name: 'AB kurz (Kopie)', istStandard: false, zweck: 'allgemein' });
		// Standard löschen → ein anderer übernimmt
		const std = (await listeMailVorlagen(kA(), 'allgemein')).find((x) => x.istStandard)!;
		await loescheMailVorlage(kA(), std.id);
		expect((await listeMailVorlagen(kA(), 'allgemein')).filter((x) => x.istStandard)).toHaveLength(1);
		await expect(loescheMailVorlage(kB(), v.id)).rejects.toMatchObject({ status: 404 });
		await expect(setzeStandard(kB(), v.id)).rejects.toMatchObject({ status: 404 });
	});

	it('Rechte: Bibliothek nur mit vorlagen.verwalten (Seite 403, Aktion 403)', async () => {
		expect(() => vorlagenZugriff({ nutzer: u.monteurA })).toThrow();
		await expect(load({ locals: { nutzer: u.monteurA } } as never)).rejects.toMatchObject({ status: 403 });
		const f = new FormData();
		f.set('name', 'Böse');
		f.set('betreff', 'x');
		f.set('html', 'x');
		const r = (await actions.vorlage({ locals: { nutzer: u.monteurA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never)) as { status: number };
		expect(r.status).toBe(403);
		expect((await listeMailVorlagen(kA())).some((v) => v.name === 'Böse')).toBe(false);
	});

	it('Auftragsbestätigung: Mail aus der Standard-Vorlage (mit Signatur nur wenn gewollt); andere Vorlage wählbar; gesendet = fest', async () => {
		await leereAngebote(root);
		await speichereSignatur(kA(), '<p>Bauwelt A – Team</p>');
		const eigene = await speichereMailVorlage(kA(), null, {
			name: 'AB förmlich',
			zweck: 'auftragsbestaetigung',
			betreff: 'Ihre Auftragsbestätigung {{ab.nummer}} ({{betrag}})',
			html: '<p>{{kunde.anrede}}, anbei {{ab.nummer}} zu {{angebot.nummer}}.</p>',
			mitSignatur: ''
		});
		await setzeStandard(kA(), eigene.id);
		const gesendet: { betreff: string; html: string; text: string }[] = [];
		const auftrag = await u.neuerAuftrag('angebot', 'Bad neu');
		const [an] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${auftrag}, 'entwurf', '2099-12-31') returning id, nummer`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent) values (${u.betriebA}, ${an.id}, 1, 'Fliesen', 10, 'm²', 10000)`;
		await root`update app.angebote set status = 'versendet' where id = ${an.id}`;
		await root`update app.angebote set status = 'angenommen' where id = ${an.id}`;
		await beiAngebotAngenommen({ betriebId: u.betriebA, benutzerId: u.ids.chefA, angebotId: an.id, auftragId: auftrag, quelle: 'oberflaeche' } as never);
		const [ab] = await root`select id, nummer, mail_betreff, mail_text, versand_status from app.auftragsbestaetigungen where angebot_id = ${an.id}`;
		expect(ab.mail_betreff).toMatch(new RegExp(`^Ihre Auftragsbestätigung ${ab.nummer} \\(1\\.190,00\\s€\\)$`));
		expect(ab.mail_text).toContain(`Sehr geehrter Herr Müller, anbei ${ab.nummer} zu ${an.nummer}.`);
		expect(ab.mail_text).not.toContain('Bauwelt A – Team');
		// andere Vorlage (eingebaute „Auftragsbestätigung“, mit Signatur)
		const eingebaut = (await listeMailVorlagen(kA(), 'auftragsbestaetigung')).find((v) => v.name === 'Auftragsbestätigung')!;
		await abMitVorlage(kA(), auftrag, ab.id, eingebaut.id);
		const [neu] = await root`select mail_betreff, mail_text from app.auftragsbestaetigungen where id = ${ab.id}`;
		expect(neu.mail_betreff).toBe(`Auftragsbestätigung ${ab.nummer} – Bad neu`);
		expect(neu.mail_text).toContain('Bauwelt A – Team');
		// falscher Auftrag → 404; gesendet → 409
		await expect(abMitVorlage(kA(), u.auftragA, ab.id, eingebaut.id)).rejects.toMatchObject({ status: 404 });
		await root`update app.auftragsbestaetigungen set versand_status = 'gesendet', versendet_am = now() where id = ${ab.id}`;
		await expect(abMitVorlage(kA(), auftrag, ab.id, eingebaut.id)).rejects.toMatchObject({ status: 409 });
		// mit angebundenem Versand geht die HTML-Fassung der Vorlage raus
		setzeMailVersand({ verbunden: true, senden: async (m) => void gesendet.push(m) });
		const a2 = await u.neuerAuftrag('angebot', 'Küche neu');
		const [an2] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${a2}, 'entwurf', '2099-12-31') returning id`;
		await root`update app.angebote set status = 'versendet' where id = ${an2.id}`;
		await root`update app.angebote set status = 'angenommen' where id = ${an2.id}`;
		await beiAngebotAngenommen({ betriebId: u.betriebA, benutzerId: u.ids.chefA, angebotId: an2.id, auftragId: a2, quelle: 'oberflaeche' } as never);
		setzeMailVersand(null);
		expect(gesendet).toHaveLength(1);
		expect(gesendet[0].html).toMatch(/^<p>Sehr geehrter Herr Müller, anbei AB-/);
	});

	it('Mail an Kunden: Werte aus Kunde/Auftrag/Angebot, Betrag nur mit Preisen, Standard zuerst', async () => {
		const m = await mailVorbereitung(kA(), { auftragId: u.auftragA }, ['bewertung', 'allgemein'], { preise: false });
		expect(m.an).toBe('mueller@kunde.test');
		expect(m.werte).toMatchObject({ 'kunde.anrede': 'Sehr geehrter Herr Müller', 'auftrag.titel': 'Badsanierung' });
		expect(m.werte.betrag).toBeUndefined();
		expect(m.vorlagen[0]).toMatchObject({ zweck: 'bewertung', istStandard: true });
		expect(m.vorlagen.every((v) => v.zweck === 'bewertung' || v.zweck === 'allgemein')).toBe(true);
	});
});
