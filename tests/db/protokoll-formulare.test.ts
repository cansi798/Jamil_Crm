import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { sichtVon } from '../../src/lib/server/auftraege';
import {
	archiviereVorlage,
	dupliziereVorlage,
	holeProtokoll,
	holeVorlage,
	legeVorlageAn,
	listeProtokolle,
	listeVorlagen,
	loescheEntwurf,
	loescheProtokollDatei,
	protokollPdf,
	protokollVerlauf,
	schliesseAb,
	speichereAntworten,
	speichereFoto,
	speichereUnterschrift,
	speichereVorlage,
	starteProtokoll,
	uebernimmStartvorlagen
} from '../../src/lib/server/protokoll-formulare';
import { protokollRechte, zugriffAusfuellen, zugriffLesen, zugriffVorlagen } from '../../src/lib/server/protokoll-zugriff';
import { STARTVORLAGEN } from '../../src/lib/protokoll-startvorlagen';
import { baueUmgebung, testPng, UNBEKANNT, type Umgebung } from './hilfe-1c';

/** Frei gestaltbare Protokolle (Migration 040): Versionen, RLS, Sperre nach Abschluss, Rechte, PDF im Auftrag. */
describe('Protokoll-Formulare', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kM = () => ({ betriebId: u.betriebA, benutzerId: u.ids.monteurA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const alle = () => sichtVon(u.chefA);
	const abdichtung = STARTVORLAGEN.find((s) => s.schluessel === 'abdichtung-bad')!;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.protokolle`;
		await root`delete from app.protokoll_vorlagen`;
		await root`delete from app.auftrag_zustaendige`;
	});

	/** Abdichtungsprotokoll komplett ausfüllen (ohne Mangel), mit Foto und Kunden-Unterschrift. */
	async function fuelleAus(k = kA(), sicht = alle()) {
		const v = (await legeVorlageAn(kA(), { name: abdichtung.name, schema: abdichtung.schema })).id;
		const p = await starteProtokoll(k, sicht, { vorlageId: v, auftragId: u.auftragA });
		await speichereAntworten(k, sicht, p.id, {
			datum: '2026-10-20',
			untergrund: 'Zementestrich',
			restfeuchte: 1.8,
			tragfaehig: true,
			system: 'Flüssigabdichtung',
			ausfuehrung: abdichtung.schema.seiten[1].abschnitte[1].felder[0].optionen,
			mangel: false
		});
		const foto = await speichereFoto(k, sicht, p.id, 'foto_abdichtung', { name: 'a.png', inhalt: testPng(40, 30) });
		await speichereUnterschrift(k, sicht, p.id, 'unterschrift_kunde', testPng(60, 20), 'Erika Mustermann');
		return { vorlageId: v, protokollId: p.id, fotoId: foto.datei.id };
	}

	it('Vorlagen: Speichern legt eine neue Version an, alte bleibt für Protokolle erhalten; Duplizieren/Archivieren', async () => {
		const v1 = await legeVorlageAn(kA(), { name: 'Test', schema: abdichtung.schema });
		expect(v1).toMatchObject({ version: 1, aktuell: true, seiten: 5 });
		const p = await starteProtokoll(kA(), alle(), { vorlageId: v1.id, auftragId: u.auftragA });
		const schema2 = structuredClone(abdichtung.schema);
		schema2.seiten[0].titel = 'Untergrund prüfen';
		const v2 = await speichereVorlage(kA(), v1.id, { name: 'Test', schema: schema2 });
		expect(v2.version).toBe(2);
		expect(v2.id).not.toBe(v1.id);
		// alte Version nicht mehr aktuell → erneutes Speichern darauf: 409
		await expect(speichereVorlage(kA(), v1.id, { name: 'Test', schema: schema2 })).rejects.toMatchObject({ status: 409 });
		// unverändert → keine neue Version
		expect((await speichereVorlage(kA(), v2.id, { name: 'Test', schema: schema2 })).id).toBe(v2.id);
		// Protokoll behält Version 1
		const gelesen = await holeProtokoll(kA(), alle(), p.id);
		expect(gelesen.version).toBe(1);
		expect(gelesen.schema.seiten[0].titel).toBe('Untergrund');
		expect((await holeVorlage(kA(), v1.id)).aktuell).toBe(false);
		// Liste: nur aktuelle Versionen, Zähler über alle Versionen
		expect((await listeVorlagen(kA())).map((v) => [v.name, v.version, v.protokolle])).toEqual([['Test', 2, 1]]);
		// Version unveränderlich: Schema lässt sich auch direkt als crm_app nicht ändern
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.protokoll_vorlagen set schema = '{}' where id = ${v1.id}`)).rejects.toThrow(
			/permission denied/
		);
		const kopie = await dupliziereVorlage(kA(), v2.id);
		expect(kopie).toMatchObject({ name: 'Test (Kopie)', version: 1 });
		await archiviereVorlage(kA(), kopie.id, true);
		expect((await listeVorlagen(kA())).map((v) => v.name)).toEqual(['Test']);
		await expect(starteProtokoll(kA(), alle(), { vorlageId: kopie.id, auftragId: u.auftragA })).rejects.toMatchObject({ status: 400 });
		// ungültiges Schema → 400 mit Meldung
		await expect(legeVorlageAn(kA(), { name: 'X', schema: { seiten: [] } })).rejects.toMatchObject({ status: 400, message: /mindestens eine Seite/ });
	});

	it('Beispielvorlagen übernehmen ist idempotent', async () => {
		expect(await uebernimmStartvorlagen(kA())).toBe(2);
		expect(await uebernimmStartvorlagen(kA())).toBe(0);
		expect((await listeVorlagen(kA())).map((v) => v.name)).toEqual(['Abdichtungsprotokoll Bad', 'Abnahmeprotokoll']);
	});

	it('RLS: Betrieb B sieht weder Vorlagen noch Protokolle noch Fotos von A (404 bzw. leer)', async () => {
		const { vorlageId, protokollId, fotoId } = await fuelleAus();
		await expect(holeVorlage(kB(), vorlageId)).rejects.toMatchObject({ status: 404 });
		await expect(holeProtokoll(kB(), sichtVon(u.chefB), protokollId)).rejects.toMatchObject({ status: 404 });
		await expect(speichereAntworten(kB(), sichtVon(u.chefB), protokollId, {})).rejects.toMatchObject({ status: 404 });
		await expect(starteProtokoll(kB(), sichtVon(u.chefB), { vorlageId, auftragId: u.auftragB })).rejects.toMatchObject({ status: 404 });
		for (const tabelle of ['protokoll_vorlagen', 'protokolle', 'protokoll_dateien']) {
			expect(await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select id from ${tx('app.' + tabelle)}`), tabelle).toHaveLength(0);
		}
		// Einfügen in fremden Betrieb verweigert (WITH CHECK)
		await expect(
			u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`
				insert into app.protokoll_dateien (betrieb_id, protokoll_id, feld_id, art, name, typ, groesse, inhalt)
				values (${u.betriebA}, ${protokollId}, 'x', 'foto', 'x.png', 'image/png', 1, '\\x00')`)
		).rejects.toThrow();
		expect(fotoId).toBeTruthy();
	});

	it('Monteur sieht nur Protokolle seiner Aufträge (404), zuständig → darf ausfüllen', async () => {
		const v = (await legeVorlageAn(kA(), { name: abdichtung.name, schema: abdichtung.schema })).id;
		const sichtM = sichtVon(u.monteurA);
		await expect(starteProtokoll(kM(), sichtM, { vorlageId: v, auftragId: u.auftragA })).rejects.toMatchObject({ status: 404 });
		const p = await starteProtokoll(kA(), alle(), { vorlageId: v, auftragId: u.auftragA });
		await expect(holeProtokoll(kM(), sichtM, p.id)).rejects.toMatchObject({ status: 404 });
		await root`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA})`;
		const gelesen = await holeProtokoll(kM(), sichtM, p.id);
		expect(gelesen.id).toBe(p.id);
		// Startdatum vorbelegt (heute)
		expect(gelesen.antworten.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const neu = await speichereAntworten(kM(), sichtM, p.id, { untergrund: 'Gipskarton', unsinn: 1 });
		expect(neu).toMatchObject({ untergrund: 'Gipskarton' });
		expect(neu).not.toHaveProperty('unsinn');
	});

	it('Rechte: Vorlagen nur Chef/Büro, Ausfüllen auch Monteur, ohne Modul 402', async () => {
		const locals = (n: Nutzer) => ({ nutzer: n });
		await expect(zugriffVorlagen(locals(u.chefA))).resolves.toBeTruthy();
		await expect(zugriffVorlagen(locals(u.bueroA))).resolves.toBeTruthy();
		await expect(zugriffVorlagen(locals(u.monteurA))).rejects.toMatchObject({ status: 403 });
		await expect(zugriffAusfuellen(locals(u.monteurA))).resolves.toBeTruthy();
		await expect(zugriffLesen(locals(u.monteurA))).resolves.toBeTruthy();
		await expect(zugriffAusfuellen(locals(u.nurAngeboteA))).rejects.toMatchObject({ status: 403 });
		await expect(zugriffAusfuellen(locals(u.chefC))).rejects.toMatchObject({ status: 402 });
		expect(await protokollRechte(u.monteurA)).toEqual({ lesen: true, ausfuellen: true, vorlagen: false });
		expect(await protokollRechte(u.chefC)).toEqual({ lesen: false, ausfuellen: false, vorlagen: false });
	});

	it('Abschließen nur vollständig; danach gesperrt (auch in der DB), PDF in den Dokumenten, Verlauf', async () => {
		const v = (await legeVorlageAn(kA(), { name: abdichtung.name, schema: abdichtung.schema })).id;
		const leer = await starteProtokoll(kA(), alle(), { vorlageId: v, auftragId: u.auftragA });
		await expect(schliesseAb(kA(), alle(), leer.id)).rejects.toMatchObject({ status: 400, message: /Noch nicht fertig/ });

		const { protokollId, fotoId } = await fuelleAus();
		// Foto falscher Typ / falsches Feld
		await expect(speichereFoto(kA(), alle(), protokollId, 'foto_abdichtung', { name: 'x', inhalt: new TextEncoder().encode('kein Bild') })).rejects.toMatchObject({ status: 400 });
		await expect(speichereFoto(kA(), alle(), protokollId, 'datum', { name: 'x', inhalt: testPng() })).rejects.toMatchObject({ status: 400 });

		const erg = await schliesseAb(kA(), alle(), protokollId);
		expect(erg.pdfDateiId).toBeTruthy();
		const p = await holeProtokoll(kA(), alle(), protokollId);
		expect(p).toMatchObject({ status: 'abgeschlossen', unterschriebenVon: 'Erika Mustermann', abgeschlossenVonName: 'Chef A', pdfDateiId: erg.pdfDateiId });

		// gesperrt: Dienste 409, DB-Trigger auch an der Anwendung vorbei
		await expect(speichereAntworten(kA(), alle(), protokollId, { mangel: true })).rejects.toMatchObject({ status: 409 });
		await expect(speichereFoto(kA(), alle(), protokollId, 'foto_details', { name: 'b.png', inhalt: testPng() })).rejects.toMatchObject({ status: 409 });
		await expect(loescheProtokollDatei(kA(), alle(), protokollId, fotoId)).rejects.toMatchObject({ status: 409 });
		await expect(loescheEntwurf(kA(), alle(), protokollId)).rejects.toMatchObject({ status: 409 });
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.protokolle set antworten = '{}' where id = ${protokollId}`)).rejects.toThrow(/abgeschlossen/);
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.protokolle set status = 'entwurf', abgeschlossen = null where id = ${protokollId}`)).rejects.toThrow(
			/abgeschlossen/
		);
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`delete from app.protokoll_dateien where id = ${fotoId}`)).rejects.toThrow(/abgeschlossen/);
		await expect(root`update app.protokolle set antworten = '{}' where id = ${protokollId}`).rejects.toThrow(/abgeschlossen/);

		// PDF im Auftrag (app.dateien) und abrufbar
		const [d] = await root`select name, typ, auftrag_id, octet_length(inhalt) as n from app.dateien where id = ${erg.pdfDateiId}`;
		expect(d).toMatchObject({ typ: 'application/pdf', auftrag_id: u.auftragA });
		expect(d.name).toMatch(/^Protokoll Abdichtungsprotokoll Bad \d{2}\.\d{2}\.\d{4}\.pdf$/);
		const pdf = await protokollPdf(kA(), alle(), protokollId);
		expect(Buffer.from(pdf.pdf).subarray(0, 5).toString()).toBe('%PDF-');

		// Verlauf des Auftrags
		const verlauf = (await protokollVerlauf(kA(), u.auftragA)).map((v) => v.zeile.titel);
		expect(verlauf).toContain('Protokoll „Abdichtungsprotokoll Bad“ abgeschlossen – unterschrieben von Erika Mustermann');
		expect(verlauf).toContain('Protokoll „Abdichtungsprotokoll Bad“ als PDF in den Dokumenten abgelegt');
		expect(verlauf).toContain('Protokoll „Abdichtungsprotokoll Bad“ gestartet');
		expect((await listeProtokolle(kA(), { auftragId: u.auftragA })).map((x) => x.status).sort()).toEqual(['abgeschlossen', 'entwurf']);

		// Löschen des Auftrags (Kaskade) geht trotz Sperre
		const a2 = await u.neuerAuftrag();
		const p2 = await starteProtokoll(kA(), alle(), { vorlageId: v, auftragId: a2 });
		await speichereFoto(kA(), alle(), p2.id, 'foto_abdichtung', { name: 'c.png', inhalt: testPng() });
		await root`update app.protokolle set antworten = antworten where id = ${p2.id}`;
		await root`update app.protokolle set status = 'abgeschlossen', abgeschlossen = now() where id = ${p2.id}`;
		await root`delete from app.auftraege where id = ${a2}`;
		expect(await root`select 1 from app.protokolle where id = ${p2.id}`).toHaveLength(0);
	});

	it('Entwurf: Foto löschen, Unterschrift ersetzen, Entwurf verwerfen; unbekannte IDs → 404', async () => {
		const { protokollId, fotoId } = await fuelleAus();
		let a = await loescheProtokollDatei(kA(), alle(), protokollId, fotoId);
		expect(a).not.toHaveProperty('foto_abdichtung');
		a = await speichereUnterschrift(kA(), alle(), protokollId, 'unterschrift_kunde', testPng(10, 10), 'Max Muster');
		expect((a.unterschrift_kunde as { name: string }).name).toBe('Max Muster');
		expect(await root`select 1 from app.protokoll_dateien where protokoll_id = ${protokollId} and art = 'unterschrift'`).toHaveLength(1);
		await expect(speichereUnterschrift(kA(), alle(), protokollId, 'unterschrift_kunde', testPng(), '')).rejects.toMatchObject({ status: 400 });
		await expect(holeProtokoll(kA(), alle(), UNBEKANNT)).rejects.toMatchObject({ status: 404 });
		expect(await loescheEntwurf(kA(), alle(), protokollId)).toBe(u.auftragA);
		expect(await root`select 1 from app.protokoll_dateien where protokoll_id = ${protokollId}`).toHaveLength(0);
	});

	it('Monteur-Rolle hat protokolle.ausfuellen', async () => {
		const [r] = await root`select rechte from app.rollen where betrieb_id = ${u.betriebA} and name = 'Monteur'`;
		expect(r.rechte).toContain('protokolle.ausfuellen');
	});
});
