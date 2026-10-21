import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import {
	aendereDienst,
	kommendeBuchungen,
	legeDienstAn,
	listeDienste,
	listeTerminarten,
	loescheDienst,
	speichereArbeitszeiten,
	verschiebeDienst
} from '../../src/lib/server/buchung';
import { bucheTermin, ladeSeite, sageAb } from '../../src/lib/server/buchung-oeffentlich';
import { aendereEinsatz, holeEinsatz, legeEinsatzAn, legeGruppeAn } from '../../src/lib/server/plantafel';
import { raeumeTestdatenAuf } from '../../src/lib/server/testdaten';
import { berlinTag, berlinZeitpunkt, tagPlus } from '../../src/lib/zeit';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/**
 * Terminarten (Jamil msg 3074): EINE Liste je Betrieb (Tabelle app.buchung_dienste) für Plantafel und Online-Buchung;
 * nur „online buchbare“ erscheinen öffentlich; Einsätze mit und ohne Terminart. Dazu das Aufräumen nach Browser-Tests
 * (Jamil msgs 3075/3076), das ausschließlich „E2E …“-Daten eines Laufs löscht.
 */
describe('Terminarten', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const morgen = tagPlus(berlinTag(new Date()), 1);
	const tag = tagPlus(morgen, 1);
	const JETZT = berlinZeitpunkt(morgen, 5, 0);
	const um = (h: number, m = 0, t = tag) => berlinZeitpunkt(t, h, m).toISOString();
	const ALLE_TAGE = [0, 1, 2, 3, 4, 5, 6].map((wochentag) => ({ wochentag, von: '08:00', bis: '18:00' }));
	const standardLink = (d: { links: { benutzerId: string | null; token: string }[] }) => d.links.find((l) => !l.benutzerId)!.token;
	let nr = 0;
	const kontakt = (nachname: string) => ({
		vorname: 'Erika',
		nachname,
		email: `${nachname.replace(/\s+/g, '-').toLowerCase()}-${++nr}@beispiel.test`,
		telefon: `040 77700${nr}`,
		strasse: 'Testweg 7',
		plz: '22846',
		ort: 'Norderstedt'
	});

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await speichereArbeitszeiten(kA(), u.ids.monteurA, null, ALLE_TAGE);
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('anlegen, ändern, Reihenfolge; Standard „online buchbar“; Kurzliste für den Einsatz-Dialog', async () => {
		const besichtigung = await legeDienstAn(kA(), { name: 'Besichtigung', dauerMin: 60, farbe: '#107c10' }, [u.ids.monteurA]);
		const wartung = await legeDienstAn(kA(), { name: 'Wartung', dauerMin: 90, einsatzArt: 'wartung', onlineBuchbar: false });
		const aufmass = await legeDienstAn(kA(), { name: 'Aufmaß', dauerMin: 45, onlineBuchbar: 'off' });
		expect(besichtigung.onlineBuchbar).toBe(true);
		expect(wartung.onlineBuchbar).toBe(false);
		expect(aufmass.onlineBuchbar).toBe(false);
		await expect(legeDienstAn(kA(), { name: ' besichtigung ' })).rejects.toThrow(/schon eine Terminart/);

		expect((await listeTerminarten(kA())).map((t) => t.name)).toEqual(['Besichtigung', 'Wartung', 'Aufmaß']);
		await verschiebeDienst(kA(), aufmass.id, 'hoch');
		await verschiebeDienst(kA(), aufmass.id, -1);
		await verschiebeDienst(kA(), aufmass.id, 'hoch'); // schon oben: nichts passiert
		const liste = await listeTerminarten(kA());
		expect(liste.map((t) => t.name)).toEqual(['Aufmaß', 'Besichtigung', 'Wartung']);
		expect(liste[2]).toEqual({ id: wartung.id, name: 'Wartung', farbe: '#0f6cbd', dauerMin: 90, einsatzArt: 'wartung', aktiv: true });
		await expect(verschiebeDienst(kA(), aufmass.id, 'seitwärts')).rejects.toThrow(/Richtung/);
		// fremder Betrieb sieht und verschiebt nichts
		expect(await listeTerminarten(kB())).toEqual([]);
		await expect(verschiebeDienst(kB(), aufmass.id, 'runter')).rejects.toThrow(/nicht gefunden/);

		const geaendert = await aendereDienst(kA(), wartung.id, { onlineBuchbar: true, name: 'Wartung Heizung' });
		expect(geaendert).toMatchObject({ onlineBuchbar: true, name: 'Wartung Heizung', dauerMin: 90 });
		await aendereDienst(kA(), wartung.id, { onlineBuchbar: false });
		expect((await listeDienste(kA())).find((d) => d.id === wartung.id)!.onlineBuchbar).toBe(false);
	});

	it('Online-Buchung zeigt nur online buchbare (und eingeschaltete) Terminarten', async () => {
		const nurIntern = await legeDienstAn(kA(), { name: 'Nur intern', dauerMin: 60, vorlaufMin: 0, onlineBuchbar: false, modus: 'fest' }, [u.ids.monteurA]);
		expect(await ladeSeite(standardLink(nurIntern))).toBeNull();
		await expect(
			bucheTermin(standardLink(nurIntern), { beginn: um(9), kontakt: kontakt('Bucher Intern'), antworten: {}, datenschutz: true, fotos: [] }, { jetzt: JETZT })
		).rejects.toThrow();
		// auch direkt in der Datenbank: das Token wird nicht aufgelöst
		const [l] = await root`select count(*)::int as n from app.buchung_link_aufloesen(${standardLink(nurIntern)})`;
		expect(l.n).toBe(0);

		const online = await aendereDienst(kA(), nurIntern.id, { onlineBuchbar: true });
		const seite = await ladeSeite(standardLink(online));
		expect(seite).not.toBeNull();
		expect(JSON.stringify(seite)).toContain('Nur intern');
		// Buchung: der Einsatz in der Plantafel trägt die Terminart
		const r = await bucheTermin(standardLink(online), { beginn: um(10), kontakt: kontakt('Bucher Online'), antworten: {}, datenschutz: true, fotos: [] }, { jetzt: JETZT });
		const [b] = await root`select id, einsatz_id from app.buchungen where dienst_id = ${online.id} and status = 'aktiv'`;
		const e = await holeEinsatz(kA(), b.einsatz_id);
		expect(e.terminart).toEqual({ id: online.id, name: 'Nur intern', farbe: '#0f6cbd' });
		// ausgeschaltet: wieder kein Link
		await aendereDienst(kA(), online.id, { aktiv: false });
		expect(await ladeSeite(standardLink(online))).toBeNull();
		await aendereDienst(kA(), online.id, { aktiv: true });

		// Absage: Buchung bleibt (abgesagt) in der Liste, zählt aber nicht mehr als „kommend“
		await sageAb(r.verwaltungToken, JETZT);
		const kommend = await kommendeBuchungen(kA(), online.id);
		expect(kommend.map((x) => x.status)).toEqual(['storniert']);
		expect((await listeDienste(kA())).find((d) => d.id === online.id)!.kommend).toBe(0);
	});

	it('Einsatz ohne und mit Terminart; ändern, abwählen; fremde/ausgeschaltete Terminart → 400', async () => {
		const [besichtigung] = (await listeTerminarten(kA())).filter((t) => t.name === 'Besichtigung');
		const ohne = await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: um(7, 0, tagPlus(tag, 7)), ende: um(9, 0, tagPlus(tag, 7)) });
		expect(ohne.terminart).toBeNull();
		expect(ohne.art).toBe('montage');

		const mit = await legeEinsatzAn(kA(), {
			auftragId: u.auftragA,
			benutzerId: u.ids.monteurA,
			beginn: um(10, 0, tagPlus(tag, 7)),
			ende: um(11, 0, tagPlus(tag, 7)),
			terminartId: besichtigung.id,
			art: 'besichtigung'
		});
		expect(mit.terminart).toEqual({ id: besichtigung.id, name: 'Besichtigung', farbe: '#107c10' });
		expect(mit.art).toBe('besichtigung');

		// Verschieben ohne Angabe lässt die Terminart stehen; „– keine –“ (null/'') nimmt sie weg
		const verschoben = await aendereEinsatz(kA(), mit.id, { beginn: um(12, 0, tagPlus(tag, 7)), ende: um(13, 0, tagPlus(tag, 7)) });
		expect(verschoben.terminart?.id).toBe(besichtigung.id);
		expect((await aendereEinsatz(kA(), mit.id, { terminartId: '' })).terminart).toBeNull();
		expect((await aendereEinsatz(kA(), ohne.id, { terminartId: besichtigung.id })).terminart?.name).toBe('Besichtigung');

		// Terminart aus Betrieb B oder Unsinn → 400
		const fremd = await legeDienstAn(kB(), { name: 'Fremd' });
		await expect(aendereEinsatz(kA(), ohne.id, { terminartId: fremd.id })).rejects.toMatchObject({ status: 400 });
		await expect(aendereEinsatz(kA(), ohne.id, { terminartId: 'kaputt' })).rejects.toMatchObject({ status: 400 });
		// Datenbank verhindert fremde Terminart auch direkt (Fremdschlüssel mit Betrieb)
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.einsaetze set terminart_id = ${fremd.id} where id = ${ohne.id}`)).rejects.toThrow(
			/foreign key|Fremdschlüssel/
		);

		// ausgeschaltete Terminart: neu nicht wählbar, am Einsatz bleibt sie
		await aendereDienst(kA(), besichtigung.id, { aktiv: false });
		await expect(legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: um(15, 0, tagPlus(tag, 7)), ende: um(16, 0, tagPlus(tag, 7)), terminartId: besichtigung.id })).rejects.toMatchObject({ status: 400 });
		expect((await aendereEinsatz(kA(), ohne.id, { notiz: 'bleibt' })).terminart?.id).toBe(besichtigung.id);
		await aendereDienst(kA(), besichtigung.id, { aktiv: true });

		// mehrtägig: jede Zeile der Gruppe bekommt die Terminart
		const g = await legeGruppeAn(kA(), {
			auftragId: u.auftragA,
			benutzerIds: [u.ids.monteurA],
			vonTag: tagPlus(tag, 14),
			bisTag: tagPlus(tag, 15),
			ohneWochenende: false,
			terminartId: besichtigung.id
		});
		expect(g.einsaetze.map((e) => e.terminart?.id)).toEqual([besichtigung.id, besichtigung.id]);

		// Terminart löschen (ohne Buchungen): Einsätze bleiben, nur ohne Terminart
		const kurz = await legeDienstAn(kA(), { name: 'Kurz', dauerMin: 15 });
		const e2 = await aendereEinsatz(kA(), ohne.id, { terminartId: kurz.id });
		expect(e2.terminart?.name).toBe('Kurz');
		expect(await loescheDienst(kA(), kurz.id)).toBe('geloescht');
		expect((await holeEinsatz(kA(), ohne.id)).terminart).toBeNull();
	});

	it('Aufräumen nach Browser-Tests: nur „E2E …“-Daten genau dieses Laufs; Datenbankfunktion lässt echte Buchungen in Ruhe', async () => {
		const kennung = 'desktop-abc123';
		const test = await legeDienstAn(kA(), { name: `E2E Besichtigung ${kennung}`, dauerMin: 60, vorlaufMin: 0, modus: 'fest' }, [u.ids.monteurA]);
		const andererLauf = await legeDienstAn(kA(), { name: 'E2E Besichtigung mobil-zzz999', dauerMin: 60 });
		const echt = await legeDienstAn(kA(), { name: 'Echte Beratung', dauerMin: 30, vorlaufMin: 0, modus: 'fest' }, [u.ids.monteurA]);
		await bucheTermin(standardLink(test), { beginn: um(14), kontakt: kontakt(`Bucher ${kennung}`), antworten: {}, datenschutz: true, fotos: [] }, { jetzt: JETZT });
		await bucheTermin(standardLink(echt), { beginn: um(16), kontakt: kontakt('Echter Kunde'), antworten: {}, datenschutz: true, fotos: [] }, { jetzt: JETZT });
		const eigen = await legeEinsatzAn(kA(), { titel: `E2E Termin ${kennung}`, benutzerId: u.ids.chefA, beginn: um(8, 0, tagPlus(tag, 3)), ende: um(9, 0, tagPlus(tag, 3)) });
		const [vorher] = await root`select auftrag_id, kunde_id from app.buchungen where dienst_id = ${test.id}`;

		await expect(raeumeTestdatenAuf(kA(), 'x')).rejects.toMatchObject({ status: 400 });
		const aus = await raeumeTestdatenAuf(kA(), kennung);
		expect(aus).toEqual({ terminarten: 1, buchungen: 1, einsaetze: 2, auftraege: 1, kunden: 1 });
		expect(await root`select 1 from app.buchung_dienste where id = ${test.id}`).toHaveLength(0);
		expect(await root`select 1 from app.auftraege where id = ${vorher.auftrag_id}`).toHaveLength(0);
		expect(await root`select 1 from app.kunden where id = ${vorher.kunde_id}`).toHaveLength(0);
		expect(await root`select 1 from app.einsaetze where id = ${eigen.id}`).toHaveLength(0);
		// anderer Lauf und echte Daten bleiben
		expect(await root`select 1 from app.buchung_dienste where id = ${andererLauf.id}`).toHaveLength(1);
		expect(await root`select 1 from app.buchungen where dienst_id = ${echt.id}`).toHaveLength(1);
		// Betrieb B räumt nichts in A auf
		expect(await raeumeTestdatenAuf(kB(), 'mobil-zzz999')).toEqual({ terminarten: 0, buchungen: 0, einsaetze: 0, auftraege: 0, kunden: 0 });

		// Die Datenbankfunktion löscht nie Buchungen echter Terminarten – auch nicht direkt aufgerufen
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select app.testdaten_buchungen_loeschen(${echt.id}::uuid)`)).rejects.toThrow(/E2E/);
		await expect(u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select app.testdaten_buchungen_loeschen(${andererLauf.id}::uuid)`)).rejects.toThrow(/E2E/);
		// crm_app darf Buchungen weiterhin nicht selbst löschen
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`delete from app.buchungen where dienst_id = ${echt.id}`)).rejects.toThrow(/permission|Berechtigung/);
	});
});
