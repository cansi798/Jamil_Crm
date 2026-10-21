import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { legeAngebotAn, setzeAngebotStatus, speicherePositionen } from '../../src/lib/server/angebote';
import {
	loescheMailVorlage,
	markiereGesendet,
	nachfassenZumAngebot,
	pruefeNachfassen,
	setzeKundeKeinNachfassen,
	setzeNachfassenPausiert,
	speichereMailVorlage,
	speichereSignatur,
	speichereStufe,
	uebernimmStandard,
	listeStufen,
	vorschauBeispiele
} from '../../src/lib/server/nachfassen';
import { aendereAuftrag } from '../../src/lib/server/auftraege';
import { BEISPIEL_WERTE } from '../../src/lib/nachfassen';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import { actions as seite, load as seitenLoad } from '../../src/routes/(app)/einstellungen/nachfassen/+page.server';
import { actions as mailSeite, load as mailLoad } from '../../src/routes/(app)/einstellungen/mail-vorlagen/+page.server';

/** Automatisches Nachfassen (Jamil msgs 2585, 2633, 2636): Stufen, Läufe mit Aufgabe und fertigem Mailtext, Stopp. */
describe('Nachfassen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const heute = berlinTag(new Date());
	const tag = (n: number) => tagPlus(heute, n);

	/** Versendetes Angebot, „vor `vorTagen` Tagen“ versendet. */
	async function versendet(vorTagen: number) {
		const a = await legeAngebotAn(kA(), u.auftragA);
		await speicherePositionen(kA(), a.id, [{ bezeichnung: 'Fliesen', menge: '10', einheit: 'm²', einzelpreis: '100,00' }]);
		await setzeAngebotStatus(kA(), a.id, 'versendet');
		await root`update app.angebote set versendet_am = now() - make_interval(days => ${vorTagen}) where id = ${a.id}`;
		return a.id;
	}
	const todos = async () =>
		(await root`select titel, zustaendig_id, to_char(faellig, 'YYYY-MM-DD') as faellig, erledigt_am is not null as erledigt, nachfass_id from app.todos where nachfass_id is not null order by angelegt`) as any[];

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.todos`;
		await root`delete from app.nachfass_stufen`;
		await root`delete from app.mail_vorlagen`;
		await root`update app.kunden set kein_nachfassen = false`;
		await root`delete from app.auftrag_zustaendige`;
		await leereAngebote(root);
	});

	it('Standard: Tag 3 Mail, Tag 7 Anruf, Tag 14 Mail + Aufgabe; Rechnung/Angebot getrennt; doppelt → 409', async () => {
		await uebernimmStandard(kA());
		const s = await listeStufen(kA(), 'angebot');
		expect(s.map((x) => [x.tage, x.todo, x.mail, x.zuweisung])).toEqual([
			[3, false, true, 'zustaendig'],
			[7, true, false, 'zustaendig'],
			[14, true, true, 'rolle']
		]);
		expect(await listeStufen(kA(), 'rechnung')).toEqual([]);
		await expect(uebernimmStandard(kA())).rejects.toMatchObject({ status: 409 });
		expect(await listeStufen(kB())).toEqual([]);
	});

	it('fällige Stufe → Lauf mit Mailtext (Platzhalter, Signatur) + Aufgabe für den Zuständigen; nur einmal', async () => {
		await uebernimmStandard(kA());
		await speichereSignatur(kA(), '<p>Viele Grüße<br>Bauwelt</p>');
		await aendereAuftrag(kA(), u.auftragA, { zustaendige: [u.ids.monteurA] });
		const id = await versendet(4);
		expect(await pruefeNachfassen(kA())).toBe(1);
		expect(await pruefeNachfassen(kA())).toBe(0); // nicht doppelt
		const n = await nachfassenZumAngebot(kA(), id);
		expect(n.laeufe).toHaveLength(1);
		const l = n.laeufe[0];
		expect(l).toMatchObject({ stufeNr: 1, tage: 3, zustaendigName: 'Ali Monteur', gesendetAm: null });
		expect(l.mailBetreff).toMatch(/^Ihr Angebot AN-/);
		expect(l.mailHtml).toMatch(/1\.190,00\s€/u); // 10 × 100 € + 19 %
		expect(l.mailHtml).toContain('<p>Viele Grüße<br>Bauwelt</p>');
		expect(l.mailText).toContain('Viele Grüße\nBauwelt');
		expect(l.mailText).not.toContain('<');
		expect(await todos()).toEqual([
			expect.objectContaining({ titel: expect.stringMatching(/^Nachfass-Mail senden: Angebot AN-.* \(.*\)$/), zustaendig_id: u.ids.monteurA, faellig: heute, erledigt: false })
		]);
		// Tag 7: Anruf-Aufgabe mit Titelvorlage
		await root`update app.angebote set versendet_am = now() - interval '8 days' where id = ${id}`;
		expect(await pruefeNachfassen(kA())).toBe(1);
		expect((await todos()).map((t) => t.titel)[1]).toMatch(/^Kunde anrufen: .* – Angebot AN-/);
		// Als gesendet markieren erledigt das Mail-Aufgabe
		await expect(markiereGesendet(kA(), u.auftragA, l.id)).rejects.toMatchObject({ status: 404 }); // falsches Angebot
		await markiereGesendet(kA(), id, l.id);
		expect((await todos())[0].erledigt).toBe(true);
	});

	it('lange nicht geprüft: nur die letzte fällige Stufe; Rolle → erster aktiver Benutzer der Rolle', async () => {
		await uebernimmStandard(kA());
		const id = await versendet(30);
		expect(await pruefeNachfassen(kA())).toBe(1);
		const [l] = (await nachfassenZumAngebot(kA(), id)).laeufe;
		expect(l.tage).toBe(14);
		const [t] = await todos();
		const [chef] = await root`select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id where b.betrieb_id = ${u.betriebA} and r.name = 'Chef' and b.aktiv order by b.name limit 1`;
		expect(t.zustaendig_id).toBe(chef.id);
		expect(await pruefeNachfassen(kA())).toBe(0);
	});

	it('Stopp: angenommen → keine neuen Stufen, offene Nachfass-Aufgaben erledigt; Pause; Kunde „kein Nachfassen“', async () => {
		await uebernimmStandard(kA());
		const id = await versendet(4);
		await pruefeNachfassen(kA());
		await setzeAngebotStatus(kA(), id, 'angenommen');
		await root`update app.angebote set versendet_am = now() - interval '8 days' where id = ${id}`;
		expect(await pruefeNachfassen(kA())).toBe(0);
		expect((await todos()).every((t) => t.erledigt)).toBe(true);

		const p = await versendet(4);
		await setzeNachfassenPausiert(kA(), p, true);
		expect(await pruefeNachfassen(kA())).toBe(0);
		expect((await nachfassenZumAngebot(kA(), p)).pausiert).toBe(true);
		await setzeNachfassenPausiert(kA(), p, false);
		await setzeKundeKeinNachfassen(kA(), u.kundeA, true);
		expect(await pruefeNachfassen(kA())).toBe(0);
		expect((await nachfassenZumAngebot(kA(), p)).kundeAus).toBe(true);
		await setzeKundeKeinNachfassen(kA(), u.kundeA, false);
		expect(await pruefeNachfassen(kA())).toBe(1);
	});

	it('Stufen prüfen: Aktion nötig, Mail braucht Vorlage, fest braucht Mitarbeiter; Vorlage in Gebrauch nicht löschbar; RLS', async () => {
		const v = await speichereMailVorlage(kA(), null, { name: 'Test', betreff: 'Hallo {{kunde.name}}', html: '<p>Hi</p>' });
		const basis = { art: 'angebot', tage: '5', todo: '', mail: '', zuweisung: 'zustaendig' };
		await expect(speichereStufe(kA(), null, basis)).rejects.toThrow(/Aufgabe anlegen/);
		await expect(speichereStufe(kA(), null, { ...basis, mail: 'on' })).rejects.toThrow(/Mail-Vorlage/);
		await expect(speichereStufe(kA(), null, { ...basis, todo: 'on', zuweisung: 'fest' })).rejects.toThrow(/Mitarbeiter/);
		await expect(speichereStufe(kA(), null, { ...basis, todo: 'on', tage: '400' })).rejects.toThrow(/Nach Tagen/);
		const s = await speichereStufe(kA(), null, { ...basis, mail: 'on', mailVorlageId: v.id, zuweisung: 'fest', benutzerId: u.ids.bueroA });
		expect(s).toMatchObject({ tage: 5, mail: true, todo: false, zuweisung: 'fest', benutzerId: u.ids.bueroA });
		await expect(loescheMailVorlage(kA(), v.id)).rejects.toMatchObject({ status: 409 });
		await expect(speichereStufe(kB(), s.id, { ...basis, todo: 'on' })).rejects.toMatchObject({ status: 404 });
		await expect(speichereStufe(kA(), null, { ...basis, todo: 'on', zuweisung: 'fest', benutzerId: u.ids.chefB })).rejects.toThrow(/Mitarbeiter nicht gefunden/);
		expect(await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select id from app.nachfass_stufen`)).toHaveLength(0);
	});

	it('Einstellungsseite: nur „Einstellungen“ (Büro/Monteur 403); Standard; Vorlagen und Signatur in der Bibliothek (msg 2789)', async () => {
		await expect(seitenLoad({ locals: { nutzer: u.bueroA } } as never)).rejects.toMatchObject({ status: 403 });
		await expect(seitenLoad({ locals: { nutzer: u.monteurA } } as never)).rejects.toMatchObject({ status: 403 });
		const req = (felder: Record<string, string>, nutzer = u.chefA) =>
			({ locals: { nutzer }, request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams(felder) }) }) as never;
		expect(await seite.standard(req({}))).toMatchObject({ gespeichert: true });
		expect(await mailSeite.signatur(req({ signatur: '<p>Gruß</p>' }))).toMatchObject({ gespeichert: true });
		const fehler = (await mailSeite.vorlage(req({ name: '', betreff: 'x', html: '<p>x</p>' }))) as any;
		expect(fehler.status).toBe(400);
		expect(fehler.data).toMatchObject({ bereich: 'vorlage-neu', werte: { betreff: 'x' } });
		// Büro hat „vorlagen.verwalten“ (Vorlage buero), Monteur nicht
		expect(((await mailSeite.signatur(req({ signatur: 'x' }, u.monteurA))) as any).status).toBe(403);
		const d = (await seitenLoad({ locals: { nutzer: u.chefA } } as never)) as any;
		expect(d.stufen).toHaveLength(3);
		// die beiden Vorschlags-Vorlagen sind „Nachfassen Angebot“; dazu je Zweck ein Standard
		expect(d.vorlagen.filter((v: any) => v.zweck === 'nachfassen_angebot')).toHaveLength(2);
		expect(d.vorlagen.filter((v: any) => v.istStandard)).toHaveLength(7);
		expect((await mailLoad({ locals: { nutzer: u.chefA } } as never) as any).signatur).toBe('<p>Gruß</p>');
		expect(d.rollen.map((r: any) => r.name)).toContain('Chef');
	});

	it('Vorschau-Beispiele (msg 2670): Beispieldaten + letzte Angebote; Betrag nur mit „Preise sehen“; Seite liefert sie', async () => {
		const id = await versendet(2);
		const mit = await vorschauBeispiele(kA(), true);
		expect(mit[0]).toMatchObject({ id: 'beispiel', werte: { 'kunde.name': 'Familie Müller' } });
		const echt = mit.find((b) => b.id === id)!;
		expect(echt.name).toMatch(/^AN-\d{4}-\d{4} · Hans Müller$/);
		expect(echt.werte).toMatchObject({ 'kunde.anrede': expect.stringMatching(/Müller/), betrag: expect.stringMatching(/^1\.190,00/) });
		const ohne = await vorschauBeispiele(kA(), false);
		expect(ohne.find((b) => b.id === id)!.werte.betrag).toBe(BEISPIEL_WERTE.betrag);
		expect((await vorschauBeispiele(kB(), true)).map((b) => b.id)).not.toContain(id); // RLS
		const d = (await mailLoad({ locals: { nutzer: u.chefA } } as never)) as any;
		expect(d.beispiele.map((b: any) => b.id)).toContain(id);
		// Beispielwerte auch für Platzhalter anderer Zwecke (Termin, Portal-Link …)
		expect(d.beispiele.find((b: any) => b.id === id).werte.termin).toBeTruthy();
	});

	it('versendet_am wird beim Versand gesetzt', async () => {
		const a = await legeAngebotAn(kA(), u.auftragA);
		await speicherePositionen(kA(), a.id, [{ bezeichnung: 'x', menge: '1', einheit: 'Stk', einzelpreis: '1,00' }]);
		expect((await root`select versendet_am from app.angebote where id = ${a.id}`)[0].versendet_am).toBeNull();
		await setzeAngebotStatus(kA(), a.id, 'versendet');
		expect((await root`select versendet_am from app.angebote where id = ${a.id}`)[0].versendet_am).not.toBeNull();
		void tag;
	});
});
