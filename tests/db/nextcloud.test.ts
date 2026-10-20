import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { pruefeSitzung } from '../../src/lib/server/auth/sitzung';
import { setzeNextcloudKonfig, type NextcloudKonfig } from '../../src/lib/server/nextcloud/konfig';
import {
	leereBetriebZwischenspeicher,
	listeVerknuepfungen,
	loeseVerknuepfung,
	meldeUeberNextcloudAn,
	verknuepfe
} from '../../src/lib/server/nextcloud/konten';
import { gleicheAb } from '../../src/lib/server/nextcloud/abgleich';
import { setzeAbrufer } from '../../src/lib/server/nextcloud/http';
import { nextcloudKanal } from '../../src/lib/server/nextcloud/melden';
import { entferneKanaele, registriereKanal, setzePushSender, stelleFaelligeZu } from '../../src/lib/server/erinnerungen';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/**
 * Nextcloud-Anbindung (Migration 070): Verknüpfung + Anmeldung (SECURITY DEFINER, Betrieb, Plattform-Admin, keine
 * Neuanlage), RLS, Abgleich gegen eine nachgebaute Nextcloud (idempotent, Umzug, Löschung), Talk als Zustellweg.
 */
describe('Nextcloud-Anbindung', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const ident = (sub: string, email: string | null = null, bestaetigt = false) => ({ sub, email, emailBestaetigt: bestaetigt, name: null });
	const konfig = (teil: Partial<NextcloudKonfig> = {}): NextcloudKonfig => ({
		url: 'https://cloud.test',
		internUrl: 'http://nextcloud',
		betrieb: u.betriebA,
		anmeldung: { clientId: 'c', clientSecret: 's', zweiFaktorVertrauen: true, perEmail: true },
		technik: { benutzer: 'crm-sync', token: 'tok' },
		kalender: true,
		kontakte: { gruppe: 'Team' },
		dateien: { ordner: 'CRM' },
		talk: true,
		intervallMinuten: 5,
		...teil
	});

	// nachgebaute Nextcloud: merkt sich PUT-Inhalte je Pfad
	const dateien = new Map<string, string>();
	const protokoll: { methode: string; pfad: string; body?: string; auth?: string }[] = [];
	const nachrichten: string[] = [];
	const fakeNc = (async (url: string, init: RequestInit) => {
		const pfad = decodeURIComponent(new URL(url).pathname);
		const methode = init.method ?? 'GET';
		const body = typeof init.body === 'string' ? init.body : init.body ? `[${(init.body as Uint8Array).byteLength} Bytes]` : undefined;
		protokoll.push({ methode, pfad, body, auth: (init.headers as Record<string, string>)?.authorization });
		if (methode === 'PUT') {
			const neu = !dateien.has(pfad);
			dateien.set(pfad, body ?? '');
			return new Response(null, { status: neu ? 201 : 204 });
		}
		if (methode === 'DELETE') return new Response(null, { status: dateien.delete(pfad) ? 204 : 404 });
		if (methode === 'MKCALENDAR' || methode === 'MKCOL') return new Response(null, { status: 201 });
		if (methode === 'PROPFIND') return new Response('<d:multistatus xmlns:d="DAV:"/>', { status: 207 });
		if (pfad.endsWith('/api/v4/room')) return new Response(JSON.stringify({ ocs: { data: { token: 'raum1234' } } }), { status: 200 });
		if (pfad.includes('/api/v1/chat/')) {
			nachrichten.push(JSON.parse(String(init.body)).message);
			return new Response('{}', { status: 201 });
		}
		if (methode === 'POST') return new Response(null, { status: 200 }); // Freigabe
		return new Response('', { status: 404 });
	}) as typeof fetch;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		setzeAbrufer(fakeNc);
	});
	afterAll(async () => {
		setzeAbrufer(null);
		setzeNextcloudKonfig(undefined);
		setzePushSender(null);
		entferneKanaele();
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.nextcloud_konten`;
		await root`delete from app.nextcloud_abgleich`;
		await root`delete from app.einsaetze`;
		await root`delete from app.dateien`;
		await root`update app.benutzer set aktiv = true`;
		leereBetriebZwischenspeicher();
		setzeNextcloudKonfig(konfig());
		dateien.clear();
		protokoll.length = 0;
		nachrichten.length = 0;
	});

	describe('Anmeldung', () => {
		it('ohne Verknüpfung und ohne bestätigte E-Mail: unbekannt – es wird nie ein Benutzer angelegt', async () => {
			const vorher = (await root`select count(*)::int as n from app.benutzer`)[0].n;
			expect(await meldeUeberNextcloudAn(konfig(), ident('fremd', 'neu@x.de', true))).toEqual({ art: 'unbekannt' });
			expect(await meldeUeberNextcloudAn(konfig(), ident('max', 'chef-a@beispiel.test', false))).toEqual({ art: 'unbekannt' });
			expect((await root`select count(*)::int as n from app.benutzer`)[0].n).toBe(vorher);
			expect((await root`select count(*)::int as n from app.nextcloud_konten`)[0].n).toBe(0);
		});

		it('bestätigte E-Mail verknüpft beim ersten Mal; danach zählt nur noch der Nextcloud-Benutzername', async () => {
			const r = await meldeUeberNextcloudAn(konfig(), ident('Chef A', 'chef-a@beispiel.test', true));
			expect(r.art).toBe('sitzung');
			const nutzer = await pruefeSitzung((r as { token: string }).token);
			expect(nutzer?.id).toBe(u.ids.chefA); // Chef hat Pflicht-2FA → Sitzung gilt als bestätigt (Vertrauen)
			const [v] = await root`select nc_benutzer, art from app.nextcloud_konten where benutzer_id = ${u.ids.chefA}`;
			expect(v).toMatchObject({ nc_benutzer: 'Chef A', art: 'email' });
			// gleiche E-Mail, anderer Nextcloud-Benutzer: kein zweites Konto
			expect((await meldeUeberNextcloudAn(konfig(), ident('Zweiter', 'chef-a@beispiel.test', true))).art).toBe('unbekannt');
			// ohne E-Mail, aber verknüpft
			expect((await meldeUeberNextcloudAn(konfig(), ident('Chef A'))).art).toBe('sitzung');
		});

		it('per E-Mail abschaltbar; nur der eingestellte Betrieb; inaktiv = nein', async () => {
			const ohne = konfig({ anmeldung: { clientId: 'c', clientSecret: 's', zweiFaktorVertrauen: true, perEmail: false } });
			expect((await meldeUeberNextcloudAn(ohne, ident('x', 'chef-a@beispiel.test', true))).art).toBe('unbekannt');
			expect((await meldeUeberNextcloudAn(konfig(), ident('b', 'chef-b@beispiel.test', true))).art).toBe('unbekannt');
			await root`update app.benutzer set aktiv = false where id = ${u.ids.bueroA}`;
			expect((await meldeUeberNextcloudAn(konfig(), ident('b2', 'buero-a@beispiel.test', true))).art).toBe('unbekannt');
		});

		it('ohne Vertrauen in die Nextcloud-2FA verlangt das CRM seinen eigenen zweiten Faktor', async () => {
			const k = konfig({ anmeldung: { clientId: 'c', clientSecret: 's', zweiFaktorVertrauen: false, perEmail: true } });
			const chef = await meldeUeberNextcloudAn(k, ident('Chef A', 'chef-a@beispiel.test', true));
			expect(chef.art).toBe('einrichten'); // Chef: Pflicht-2FA, noch nicht eingerichtet
			expect(await pruefeSitzung((chef as { token: string }).token)).toBeNull(); // nur Vor-Sitzung
			const monteur = await meldeUeberNextcloudAn(k, ident('Ali', 'monteur-a@beispiel.test', true));
			expect(monteur.art).toBe('sitzung'); // ohne Pflicht-2FA direkt
		});

		it('Datenbank: Sitzung nur für verknüpfte Konten; crm_app darf die Funktionen nicht aufrufen', async () => {
			const [z] = await root`select app.nextcloud_sitzung(${u.ids.chefA}::uuid, '\\x01'::bytea, now() + interval '1 day') as ok`;
			expect(z.ok).toBe(false);
			await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select app.nextcloud_konto_finden(${u.betriebA}::uuid, 'x', null, false, false)`)).rejects.toThrow(/permission/);
			await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select app.nextcloud_sitzung(${u.ids.chefA}::uuid, '\\x02'::bytea, now())`)).rejects.toThrow(/permission/);
		});
	});

	describe('Verknüpfen im CRM', () => {
		const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
		it('Admin verknüpft, ändert und löst; doppelt vergeben → 409; Liste nur eigener Betrieb (RLS)', async () => {
			await verknuepfe(kA(), u.ids.monteurA, ' Ali M ');
			await expect(verknuepfe(kA(), u.ids.bueroA, 'Ali M')).rejects.toMatchObject({ status: 409 });
			await expect(verknuepfe(kA(), u.ids.bueroA, 'a/b')).rejects.toMatchObject({ status: 400 });
			await expect(verknuepfe(kA(), u.ids.chefB, 'x')).rejects.toMatchObject({ status: 404 });
			const liste = await listeVerknuepfungen(kA());
			expect(liste.find((z) => z.benutzerId === u.ids.monteurA)).toMatchObject({ ncBenutzer: 'Ali M', art: 'admin' });
			expect(liste.some((z) => z.benutzerId === u.ids.chefB)).toBe(false);
			expect((await meldeUeberNextcloudAn(konfig(), ident('Ali M'))).art).toBe('sitzung');
			const b = await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select * from app.nextcloud_konten`);
			expect(b).toHaveLength(0);
			await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.nextcloud_konten set nc_benutzer = 'x'`)).rejects.toThrow(/permission/);
			await loeseVerknuepfung(kA(), u.ids.monteurA);
			expect((await meldeUeberNextcloudAn(konfig(), ident('Ali M'))).art).toBe('unbekannt');
			// Änderungsprotokoll
			const [p] = await root`select count(*)::int as n from app.aenderungen where tabelle = 'nextcloud_konten'`;
			expect(p.n).toBeGreaterThanOrEqual(2);
		});
		it('anderer Betrieb als die Anbindung → 403', async () => {
			await expect(verknuepfe({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, u.ids.chefB, 'x')).rejects.toMatchObject({ status: 403 });
		});
	});

	describe('Abgleich', () => {
		const morgen = (stunde: number) => new Date(Date.now() + 24 * 3600_000 + stunde * 3600_000);
		const puts = () => protokoll.filter((p) => p.methode === 'PUT');

		it('Termine, Kontakte, Fotos: erster Lauf schreibt, zweiter nichts, Änderung/Umzug/Löschung werden übertragen', async () => {
			await root`insert into app.nextcloud_konten (benutzer_id, betrieb_id, nc_benutzer, art) values (${u.ids.monteurA}, ${u.betriebA}, 'Ali M', 'admin')`;
			const [e] = await root`
				insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz)
				values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, ${morgen(0)}, ${morgen(4)}, 'Fliesen; Fugen') returning id`;
			const [d] = await root`
				insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt)
				values (${u.betriebA}, ${u.auftragA}, 'Foto 1.jpg', 'image/jpeg', 3, '\\x010203') returning id`;
			await root`insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt) values (${u.betriebA}, ${u.auftragA}, 'intern.pdf', 'application/pdf', 1, '\\x01')`;

			const r1 = await gleicheAb(konfig());
			expect(r1.ok).toBe(true);
			expect(r1.termine).toMatchObject({ geschrieben: 1, fehler: 0 });
			expect(r1.kontakte?.geschrieben).toBeGreaterThanOrEqual(1);
			expect(r1.dateien).toMatchObject({ geschrieben: 1, fehler: 0 }); // nur das Foto, nicht das beliebige PDF
			const ics = [...dateien.entries()].find(([p]) => p.endsWith(`crm-einsatz-${e.id}.ics`));
			expect(ics?.[0]).toMatch(/^\/remote\.php\/dav\/calendars\/crm-sync\/crm-einsaetze-[0-9a-f]{16}\/crm-einsatz-/);
			expect(ics?.[1]).toContain('DESCRIPTION:Auftrag ');
			expect(ics?.[1]).toContain('Fliesen\\; Fugen');
			expect(ics?.[1]).toContain('LOCATION:Lindenweg 3\\, 22846 Norderstedt');
			const foto = [...dateien.keys()].find((p) => p.endsWith('Foto 1.jpg'));
			expect(foto).toMatch(/^\/remote\.php\/dav\/files\/crm-sync\/CRM\/Kunden\/Hans Müller\/A-\d{4}-\d{4}\/Foto 1\.jpg$/);
			// Kalender lesend mit der Person geteilt, Adressbuch mit der Gruppe
			const freigaben = protokoll.filter((p) => p.methode === 'POST' && p.body?.includes('<o:share'));
			expect(freigaben.some((p) => p.body!.includes('principal:principals/users/Ali%20M'))).toBe(true);
			expect(freigaben.some((p) => p.body!.includes('principal:principals/groups/Team'))).toBe(true);
			expect(freigaben.every((p) => !p.body!.includes('read-write'))).toBe(true);
			expect(protokoll.every((p) => p.auth === `Basic ${Buffer.from('crm-sync:tok').toString('base64')}`)).toBe(true);

			protokoll.length = 0;
			const r2 = await gleicheAb(konfig());
			expect(puts()).toHaveLength(0);
			expect(r2.termine).toMatchObject({ geschrieben: 0, unveraendert: 1 });

			// Termin verschieben → überschreiben (gleiche UID, gleicher Pfad)
			await root`update app.einsaetze set beginn = beginn + interval '1 hour', geaendert = now() where id = ${e.id}`;
			protokoll.length = 0;
			await gleicheAb(konfig());
			expect(puts().map((p) => p.pfad)).toEqual([ics![0]]);

			// Termin an andere Person ohne Nextcloud → drüben gelöscht
			await root`update app.einsaetze set benutzer_id = ${u.ids.bueroA} where id = ${e.id}`;
			await gleicheAb(konfig());
			expect(dateien.has(ics![0])).toBe(false);

			// Foto gelöscht → drüben gelöscht
			await root`delete from app.dateien where id = ${d.id}`;
			await gleicheAb(konfig());
			expect([...dateien.keys()].some((p) => p.endsWith('Foto 1.jpg'))).toBe(false);
			const [rest] = await root`select count(*)::int as n from app.nextcloud_abgleich where art in ('termin', 'datei')`;
			expect(rest.n).toBe(0);
		});

		it('nur die Daten des eingestellten Betriebs', async () => {
			await gleicheAb(konfig());
			const vcards = [...dateien.entries()].filter(([p]) => p.endsWith('.vcf')).map(([, v]) => v).join('');
			expect(vcards).toContain('Müller');
			expect(vcards).not.toContain('Fremd');
		});

		it('ausgeschaltet → keine Anfrage', async () => {
			const r = await gleicheAb(konfig({ kalender: false, kontakte: null, dateien: null }));
			expect(r.meldung).toMatch(/aus/);
			expect(protokoll).toHaveLength(0);
		});
	});

	it('Erinnerung geht zusätzlich als Talk-Nachricht an verknüpfte Personen', async () => {
		setzePushSender(async () => ({ status: 201 }));
		registriereKanal(nextcloudKanal);
		await root`update app.rollen set rechte = array_append(rechte, 'erinnerungen.nutzen') where not ('erinnerungen.nutzen' = any (rechte))`;
		await root`insert into app.nextcloud_konten (benutzer_id, betrieb_id, nc_benutzer, art) values (${u.ids.chefA}, ${u.betriebA}, 'Chef A', 'admin')`;
		await root`delete from app.erinnerungen`;
		const [e] = await root`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${u.auftragA}, ${u.ids.chefA}, now() + interval '1 hour', now() + interval '2 hours') returning id`;
		await root`insert into app.erinnerungen (betrieb_id, benutzer_id, einsatz_id, zeitpunkt, titel, link)
			values (${u.betriebA}, ${u.ids.chefA}, ${e.id}, now() - interval '1 minute', 'Erinnerung', '/')`;
		await root`insert into app.erinnerungen (betrieb_id, benutzer_id, einsatz_id, zeitpunkt, titel, link)
			values (${u.betriebA}, ${u.ids.bueroA}, ${e.id}, now() - interval '1 minute', 'Erinnerung', '/')`;
		const r = await stelleFaelligeZu();
		expect(r.gesendet).toBe(2);
		expect(nachrichten).toHaveLength(1); // nur Chef A ist mit Nextcloud verknüpft
		expect(nachrichten[0]).toMatch(/^🔔 Termin: Badsanierung/);
		// Talk aus → keine Nachricht
		setzeNextcloudKonfig(konfig({ talk: false }));
		await root`update app.erinnerungen set gesendet_am = null, ergebnis = null`;
		await stelleFaelligeZu();
		expect(nachrichten).toHaveLength(1);
	});
});
