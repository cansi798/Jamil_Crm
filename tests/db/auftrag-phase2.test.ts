import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { aendereAuftrag, holeAuftrag, legeAuftragAn, listeAuftraege, sichtVon } from '../../src/lib/server/auftraege';
import { aendereEinsatz, legeEinsatzAn } from '../../src/lib/server/plantafel';
import { legeKundenNotizAn } from '../../src/lib/server/kundenakte';
import { actions as auftragAktionen, load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { actions as neuAktionen, load as neuLoad } from '../../src/routes/(app)/auftraege/neu/+page.server';
import { actions as bearbeitenAktionen } from '../../src/routes/(app)/auftraege/[id]/bearbeiten/+page.server';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Phase 2 der Wünsche von Jamil (19.10.2026): Zuständige, Einsatzort, Termin-Art, Kunden-Hinweise im Auftrag. */
describe('Aufträge Phase 2', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let inaktiv: string, fremd: string, objektWeg: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const form = (felder: [string, string][]) => {
		const b = new URLSearchParams();
		for (const [k, v] of felder) b.append(k, v);
		return new Request('http://localhost/x', { method: 'POST', body: b });
	};
	const aktion = async (fn: () => unknown) => {
		try {
			return { ergebnis: (await fn()) as any };
		} catch (e: any) {
			if (e?.status === 303) return { ort: e.location as string };
			throw e;
		}
	};
	const morgen = () => {
		const d = new Date(Date.now() + 86_400_000);
		return d.toISOString().slice(0, 10);
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		const [r] = await root`select rolle_id from app.benutzer where id = ${u.ids.monteurA}`;
		[{ id: inaktiv }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id, aktiv)
			values (${u.betriebA}, 'weg@beispiel.test', 'Ehemalig', 'x', ${r.rolle_id}, false) returning id`;
		fremd = u.ids.chefB;
		[{ id: objektWeg }] = await root`
			insert into app.objekte (betrieb_id, kunde_id, bezeichnung, strasse, plz, ort)
			values (${u.betriebA}, ${u.kundeA}, 'Ferienhaus', 'Dünenweg 1', '25980', 'Sylt') returning id`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	describe('Zuständige Mitarbeiter', () => {
		it('anlegen mit Zuständigen (doppelt → einmal); Monteur sieht den Auftrag dadurch; inaktiv/fremd/kaputt → 400', async () => {
			const a = await legeAuftragAn(kA(), {
				titel: 'Mit Zuständigen',
				kundeId: u.kundeA,
				zustaendige: [u.ids.monteurA, u.ids.bueroA, u.ids.monteurA]
			});
			expect(a.zustaendige.map((z) => z.name)).toEqual(['Ali Monteur', 'Büro A']);
			const monteurSieht = await listeAuftraege(kA(), sichtVon(u.monteurA), {});
			expect(monteurSieht.map((x) => x.id)).toContain(a.id);
			for (const falsch of [[inaktiv], [fremd], ['kaputt']]) {
				await expect(legeAuftragAn(kA(), { titel: 'x', kundeId: u.kundeA, zustaendige: falsch })).rejects.toMatchObject({ status: 400 });
			}
		});

		it('ändern: Liste ersetzt; ohne Angabe bleiben sie; leere Liste entfernt alle', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Ändern', kundeId: u.kundeA, zustaendige: [u.ids.monteurA] });
			expect((await aendereAuftrag(kA(), a.id, { titel: 'Neu' })).zustaendige.map((z) => z.id)).toEqual([u.ids.monteurA]);
			expect((await aendereAuftrag(kA(), a.id, { zustaendige: [u.ids.bueroA] })).zustaendige.map((z) => z.id)).toEqual([u.ids.bueroA]);
			expect((await aendereAuftrag(kA(), a.id, { zustaendige: [] })).zustaendige).toEqual([]);
		});

		it('Formulare Neu und Bearbeiten: Häkchen „zustaendige“; Bearbeiten ohne Häkchen entfernt (Marker gesendet)', async () => {
			const d = (await neuLoad({ locals: { nutzer: u.chefA }, url: new URL('http://localhost/auftraege/neu') } as never)) as any;
			expect(d.mitarbeiter.map((m: any) => m.name)).toContain('Ali Monteur');
			expect(d.mitarbeiter.map((m: any) => m.name)).not.toContain('Ehemalig');
			const r = await aktion(() =>
				neuAktionen.anlegen({
					locals: { nutzer: u.chefA },
					request: form([
						['kundeId', u.kundeA],
						['quelleId', d.quellen[0].id], // Quelle ist Pflicht (msg 2593)
						['titel', 'Formular Zuständige'],
						['zustaendigeGesendet', '1'],
						['zustaendige', u.ids.monteurA]
					])
				} as never)
			);
			const id = r.ort!.split('/').pop()!;
			expect((await holeAuftrag(kA(), sichtVon(u.chefA), id)).zustaendige.map((z) => z.id)).toEqual([u.ids.monteurA]);
			await aktion(() =>
				bearbeitenAktionen.speichern({
					locals: { nutzer: u.chefA },
					params: { id },
					request: form([
						['kundeId', u.kundeA],
						['quelleId', d.quellen[0].id], // Quelle ist Pflicht (msg 2593)
						['titel', 'Formular Zuständige'],
						['zustaendigeGesendet', '1']
					])
				} as never)
			);
			expect((await holeAuftrag(kA(), sichtVon(u.chefA), id)).zustaendige).toEqual([]);
		});
	});

	describe('Einsatzort', () => {
		it('ohne Objekt: Kundenadresse (Standard); mit Objekt: Objektadresse', async () => {
			const ohne = await legeAuftragAn(kA(), { titel: 'Ohne Objekt', kundeId: u.kundeA });
			expect(ohne).toMatchObject({ adresse: 'Lindenweg 3, 22846 Norderstedt', adresseVonObjekt: false });
			const mit = await legeAuftragAn(kA(), { titel: 'Mit Objekt', kundeId: u.kundeA, objektId: objektWeg });
			expect(mit).toMatchObject({ adresse: 'Dünenweg 1, 25980 Sylt', adresseVonObjekt: true, objektBezeichnung: 'Ferienhaus' });
		});
	});

	describe('Termine mit Art', () => {
		it('Einsatz: Art Besichtigung/Wartung, Standard Montage, unbekannt → 400; Ändern behält die Art', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Termine', kundeId: u.kundeA });
			const beginn = new Date(`${morgen()}T08:00:00Z`).toISOString();
			const ende = new Date(`${morgen()}T09:00:00Z`).toISOString();
			const b = await legeEinsatzAn(kA(), { auftragId: a.id, benutzerId: u.ids.monteurA, beginn, ende, art: 'besichtigung' });
			expect(b.art).toBe('besichtigung');
			const m = await legeEinsatzAn(kA(), { auftragId: a.id, benutzerId: u.ids.monteurA, beginn, ende });
			expect(m.art).toBe('montage');
			await expect(legeEinsatzAn(kA(), { auftragId: a.id, benutzerId: u.ids.monteurA, beginn, ende, art: 'urlaub' })).rejects.toMatchObject({
				status: 400
			});
			expect((await aendereEinsatz(kA(), b.id, { notiz: 'Schlüssel beim Nachbarn' })).art).toBe('besichtigung');
			expect((await aendereEinsatz(kA(), b.id, { art: 'wartung' })).art).toBe('wartung');
		});

		it('Auftragsseite: „+ Termin“ (Art, Mitarbeiter, Tag, von–bis) mit Plantafel-Recht; Monteur 403; Fehler als terminFehler', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Termin über Seite', kundeId: u.kundeA });
			const felder = (art: string, von = '08:00', bis = '10:30'): [string, string][] => [
				['art', art],
				['benutzerId', u.ids.monteurA],
				['tag', morgen()],
				['von', von],
				['bis', bis],
				['notiz', 'Aufmaß nehmen']
			];
			expect(
				await auftragAktionen.terminAnlegen({ locals: { nutzer: u.chefA }, params: { id: a.id }, request: form(felder('besichtigung')) } as never)
			).toBeUndefined();
			const [e] = await root`select art, notiz from app.einsaetze where auftrag_id = ${a.id}`;
			expect(e).toEqual({ art: 'besichtigung', notiz: 'Aufmaß nehmen' });
			const verboten = (await auftragAktionen.terminAnlegen({
				locals: { nutzer: u.monteurA },
				params: { id: a.id },
				request: form(felder('montage'))
			} as never)) as any;
			expect(verboten.status).toBe(403);
			const falsch = (await auftragAktionen.terminAnlegen({
				locals: { nutzer: u.chefA },
				params: { id: a.id },
				request: form(felder('montage', '10:00', '09:00'))
			} as never)) as any;
			expect(falsch.status).toBe(400);
			expect(falsch.data.terminFehler).toMatch(/Ende/);
			const d = (await auftragLoad({ locals: { nutzer: u.chefA }, params: { id: a.id } } as never)) as any;
			expect(d.einsaetze.map((x: any) => x.art)).toEqual(['besichtigung']);
			expect(d.darfTermine).toBe(true);
			expect(((await auftragLoad({ locals: { nutzer: u.bueroA }, params: { id: a.id } } as never)) as any).darfTermine).toBe(true);
		});
	});

	describe('Kunden-Hinweise in der Auftragsakte', () => {
		it('Notiz am Kunden und Kundennotizen erscheinen im Auftrag – nur mit „Kunden ansehen“', async () => {
			await root`update app.kunden set notiz = 'Zahlt nur bar' where id = ${u.kundeA}`;
			await legeKundenNotizAn(kA(), u.kundeA, 'Hund im Garten');
			const a = await legeAuftragAn(kA(), { titel: 'Hinweise', kundeId: u.kundeA });
			const d = (await auftragLoad({ locals: { nutzer: u.chefA }, params: { id: a.id } } as never)) as any;
			expect(d.kundenHinweise).toMatchObject({ notiz: 'Zahlt nur bar', notizen: [expect.objectContaining({ text: 'Hund im Garten' })] });
			const ohneKunden: Nutzer = { id: u.ids.chefA, betriebId: u.betriebA, istAdmin: false, rechte: ['auftraege.alle_lesen'], betriebStatus: 'aktiv' };
			expect(((await auftragLoad({ locals: { nutzer: ohneKunden }, params: { id: a.id } } as never)) as any).kundenHinweise).toBeNull();
		});
	});
});
