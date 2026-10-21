import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, testPng, type Umgebung } from './hilfe-1c';
import {
	holeProtokoll,
	holeVorlage,
	legeVorlageAn,
	listeVorlagen,
	speichereAntworten,
	speichereFoto,
	speichereVorlage,
	starteProtokoll,
	uebernimmStartvorlagen
} from '../../src/lib/server/protokoll-formulare';
import { angebotAusAufmass, mengenAusAufmass } from '../../src/lib/server/aufmass';
import { angeboteZugriff, holeAngebot } from '../../src/lib/server/angebote';
import { actions as protokollAktionen, load as protokollLoad } from '../../src/routes/(app)/protokolle/[id]/+page.server';

/** Aufmaß-Vorlagen (Jamil msg 2842): Art, Räume, berechnete Werte, Fotos je Raum, Angebot aus Aufmaß, Rechte. */
describe('Aufmaß-Vorlagen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const ALLE = () => ({ alle: true, benutzerId: u.ids.chefA });
	let fliese: string;
	let alt: string;
	let vorlageId: string;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		const [f] = await root`insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, einheit, lohn_cent, material_cent, arbeit_minuten)
			values (${u.betriebA}, 'fliesen', 'Bodenfliesen verlegen', 'm²', 4000, 2000, 45) returning id`;
		const [a] = await root`insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, einheit, lohn_cent, material_cent, aktiv)
			values (${u.betriebA}, 'fliesen', 'Alte Sockelleiste', 'lfm', 800, 200, false) returning id`;
		fliese = f.id;
		alt = a.id;
		const v = await legeVorlageAn(kA(), {
			art: 'aufmass',
			name: 'Boden mit Katalog',
			schema: {
				seiten: [
					{
						id: 's1',
						titel: 'Räume',
						abschnitte: [
							{
								id: 'raum',
								wiederholbar: true,
								wiederholName: 'Raum',
								felder: [
									{ id: 'l', typ: 'mass', label: 'Länge', kuerzel: 'L', pflicht: true },
									{ id: 'b', typ: 'mass', label: 'Breite', kuerzel: 'B', pflicht: true },
									{ id: 'fl', typ: 'flaeche', label: 'Fläche', kuerzel: 'fl', formel: 'L * B', katalog: { positionId: fliese, menge: 'fl * 1,1' } },
									{ id: 'so', typ: 'umfang', label: 'Sockel', formel: '2 * (L + B)', katalog: { positionId: alt } },
									{ id: 'foto', typ: 'foto', label: 'Foto' }
								]
							}
						]
					}
				]
			}
		});
		vorlageId = v.id;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Art bleibt über Versionen; Listen getrennt; Startvorlagen „Aufmaß Bad“ und „Boden/Fliesen“', async () => {
		const v1 = await holeVorlage(kA(), vorlageId);
		const v2 = await speichereVorlage(kA(), vorlageId, { name: 'Boden mit Katalog 2', schema: v1.schema });
		expect(v2).toMatchObject({ art: 'aufmass', version: 2 });
		vorlageId = v2.id;
		const neu = await uebernimmStartvorlagen(kA(), ['aufmass-bad', 'aufmass-boden']);
		expect(neu).toBe(2);
		const aufmass = (await listeVorlagen(kA(), { art: 'aufmass' })).map((v) => v.name).sort();
		expect(aufmass).toEqual(['Aufmaß Bad', 'Aufmaß Boden/Fliesen', 'Boden mit Katalog 2']);
		expect((await listeVorlagen(kA(), { art: 'protokoll' })).some((v) => v.name.startsWith('Aufmaß'))).toBe(false);
		await expect(legeVorlageAn(kA(), { art: 'quatsch', name: 'x', schema: { seiten: [] } })).rejects.toMatchObject({ status: 400 });
	});

	it('Ausfüllen: zwei Räume, berechnet und gespeichert (Eingaben für berechnete Felder zählen nicht); Foto im Raum 2', async () => {
		const p = await starteProtokoll(kA(), ALLE(), { vorlageId, auftragId: u.auftragA });
		const a = await speichereAntworten(kA(), ALLE(), p.id, { _anzahl_raum: 2, l: 4, b: 3, fl: 999, l__2: 2, b__2: 1.5 });
		expect(a).toMatchObject({ _anzahl_raum: 2, fl: 12, so: 14, fl__2: 3, so__2: 7 });
		const foto = await speichereFoto(kA(), ALLE(), p.id, 'foto__2', { name: 'raum2.png', inhalt: testPng() });
		expect(foto.antworten.foto__2).toEqual([foto.datei.id]);
		await expect(speichereFoto(kA(), ALLE(), p.id, 'foto__3', { name: 'x.png', inhalt: testPng() })).rejects.toMatchObject({ status: 400 });
		const m = await mengenAusAufmass(kA(), { sicht: ALLE() }, p.id);
		expect(m.find((x) => x.positionId === fliese)).toMatchObject({ menge: 16.5, bezeichnung: 'Bodenfliesen verlegen', fehlt: false });
		expect(m.find((x) => x.positionId === alt)).toMatchObject({ menge: 21, fehlt: true });
	});

	it('Angebot aus Aufmaß: Entwurf am Auftrag mit Katalogpreis; abgeschaltete Position übersprungen; Rechte', async () => {
		const p = (await holeProtokoll(kA(), ALLE(), (await root`select id from app.protokolle where vorlage_id = ${vorlageId} order by angelegt desc limit 1`)[0].id));
		const zg = await angeboteZugriff({ nutzer: u.chefA });
		const r = await angebotAusAufmass(kA(), zg, p.id);
		expect(r.uebersprungen).toEqual(['Alte Sockelleiste']);
		const an = await holeAngebot(kA(), r.angebotId, zg);
		expect(an).toMatchObject({ status: 'entwurf', auftragId: u.auftragA });
		expect(an.positionen.map((x) => [x.bezeichnung, x.menge, x.einzelpreisCent])).toEqual([['Bodenfliesen verlegen', 16.5, 6000]]);
		// Monteur: keine Angebotsrechte → Aktion 403; Seite zeigt Mengen-Namen, aber keinen Knopf
		const ev = (nutzer: Nutzer) => ({ locals: { nutzer }, params: { id: p.id } }) as never;
		expect(((await protokollAktionen.angebot(ev(u.monteurA))) as { status: number }).status).toBe(403);
		const d = (await protokollLoad(ev(u.chefA))) as Record<string, any>;
		expect(d.darfAngebot).toBe(true);
		expect(d.katalog[fliese]).toEqual({ bezeichnung: 'Bodenfliesen verlegen', einheit: 'm²', aktiv: true });
		expect(JSON.stringify(d.katalog)).not.toMatch(/cent|preis/i);
	});

	it('Protokoll (keine Aufmaß-Vorlage) → 400; Aufmaß ohne Mengen → klare Meldung', async () => {
		const prot = await legeVorlageAn(kA(), { name: 'Normal', schema: { seiten: [{ id: 's', titel: 'S', abschnitte: [{ id: 'a', felder: [{ id: 't', typ: 'text', label: 'T' }] }] }] } });
		const pp = await starteProtokoll(kA(), ALLE(), { vorlageId: prot.id, auftragId: u.auftragA });
		await expect(mengenAusAufmass(kA(), { sicht: ALLE() }, pp.id)).rejects.toMatchObject({ status: 400 });
		const leer = await starteProtokoll(kA(), ALLE(), { vorlageId, auftragId: u.auftragA });
		await expect(angebotAusAufmass(kA(), await angeboteZugriff({ nutzer: u.chefA }), leer.id)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Keine Mengen/) });
	});
});
