import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import {
	aktiveKennzahlen,
	cockpit,
	holeKennzahlEinstellungen,
	ohneAusgeschalteteKacheln,
	kennzahlEinstellungenZugriff,
	kundenIdsFuer,
	kundenKennzahlen,
	speichereKennzahlEinstellungen
} from '../../src/lib/server/kennzahlen';
import { startCockpit } from '../../src/lib/server/start-cockpit';
import { zeitraum } from '../../src/lib/kennzahlen';
import { load as seiteLoad, actions as seiteAktionen } from '../../src/routes/(app)/einstellungen/kennzahlen/+page.server';

/** Kennzahlen einstellen (Jamil msg 2946): an/aus, „Erfassen ab“, Rechte, RLS, Wirkung auf alle Anzeigen. */
describe('Kennzahl-Einstellungen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const ALLE = () => ({ alle: true, benutzerId: u.ids.chefA });
	const HEUTE = '2026-10-21';
	const GESAMT = zeitraum('alle', HEUTE);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		const alt = await u.neuerAuftrag('in_arbeit', 'Alter Auftrag');
		await root`update app.auftraege set angelegt = '2026-08-01T10:00:00+02:00' where id = ${alt}`;
		await root`update app.auftraege set angelegt = '2026-08-01T10:00:00+02:00' where id = ${u.auftragA}`;
		const neu = await u.neuerAuftrag('beauftragt', 'Neuer Auftrag');
		await root`update app.auftraege set angelegt = '2026-10-10T10:00:00+02:00' where id = ${neu}`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Rechte: nur „Kennzahlen einstellen“ (Chef); Büro hat es standardmäßig nicht', async () => {
		expect(() => kennzahlEinstellungenZugriff({ nutzer: u.bueroA })).toThrow();
		await expect(seiteLoad({ locals: { nutzer: u.bueroA } } as never)).rejects.toMatchObject({ status: 403 });
		const d = (await seiteLoad({ locals: { nutzer: u.chefA } } as never)) as { zeilen: { id: string; aktiv: boolean; ab: string | null }[] };
		expect(d.zeilen.find((z) => z.id === 'abschlussquote')).toMatchObject({ aktiv: true, ab: null });
		const f = new FormData();
		const r = (await seiteAktionen.default({ locals: { nutzer: u.bueroA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never)) as { status: number };
		expect(r.status).toBe(403);
	});

	it('Speichern prüft: unbekannte Kennzahl, kein Datum in der Zukunft; Standard (an, ohne Datum) wird nicht gespeichert', async () => {
		await expect(speichereKennzahlEinstellungen(kA(), { quatsch: { aktiv: true } }, HEUTE)).rejects.toMatchObject({ status: 400 });
		await expect(speichereKennzahlEinstellungen(kA(), { kunden_aktiv: { aktiv: true, ab: '2027-01-01' } }, HEUTE)).rejects.toMatchObject({ status: 400 });
		await speichereKennzahlEinstellungen(kA(), { kunden_aktiv: { aktiv: true, ab: '2026-10-01' }, abschlussquote: { aktiv: false }, durchlaufzeit: { aktiv: true, ab: '' } }, HEUTE);
		const z = await root`select kennzahl from app.kennzahl_einstellungen where betrieb_id = ${u.betriebA} order by kennzahl`;
		expect(z.map((r) => r.kennzahl)).toEqual(['abschlussquote', 'kunden_aktiv']);
		expect((await holeKennzahlEinstellungen(kA())).find((x) => x.id === 'kunden_aktiv')).toMatchObject({ aktiv: true, ab: '2026-10-01' });
	});

	it('RLS: Betrieb B sieht und ändert nichts von A', async () => {
		expect((await aktiveKennzahlen(kB())).aktiv).toContain('abschlussquote');
		const z = await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select * from app.kennzahl_einstellungen where betrieb_id = ${u.betriebA}`);
		expect(z).toHaveLength(0);
		const upd = await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`update app.kennzahl_einstellungen set aktiv = true where betrieb_id = ${u.betriebA} returning kennzahl`);
		expect(upd).toHaveLength(0);
	});

	it('Wirkung: Kachel nur ab Datum (mit Hinweis), Cockpit ohne ausgeschaltete, aktiveKennzahlen, Start ohne Handlungs-Kachel, Kundenfilter passt', async () => {
		const k = await kundenKennzahlen(kA(), ALLE(), GESAMT, { angebote: false }, HEUTE);
		expect(k).toMatchObject({ kundenAktiv: 1, seit: { kunden_aktiv: 'erfasst seit 01.10.2026' } }); // nur der neue Auftrag
		const ids = await kundenIdsFuer(kA(), ALLE(), GESAMT, 'aktiv', HEUTE);
		expect(ids.size).toBe(1);
		const c = await cockpit(kA(), zeitraum('jahr', HEUTE), true);
		expect(c.map((x) => x.id)).not.toContain('abschlussquote');
		expect(c).toHaveLength(6);
		const a = await aktiveKennzahlen(kA());
		expect(a.aktiv).not.toContain('abschlussquote');
		expect(a.einstellungen.kunden_aktiv).toEqual({ aktiv: true, ab: '2026-10-01' });
		await speichereKennzahlEinstellungen(kA(), { auftraege_nachfassen: { aktiv: false } }, HEUTE);
		const s = await startCockpit(kA(), ALLE(), { preise: true });
		expect(s.handlung.map((h) => h.id)).not.toContain('nachfassen');
		expect(s.handlung.map((h) => h.id)).toContain('aufgaben');
		expect(s.kennzahlen.map((x) => x.id)).not.toContain('abschlussquote');
		// Start-Katalog (UX-Start, msg 2942): ausgeschaltete Kennzahlen und „Nachfassen fällig“ fehlen
		const erlaubt = await ohneAusgeschalteteKacheln(kA(), new Set(['kz-abschlussquote', 'kz-termintreue', 'nachfassen', 'kennzahlen', 'heute']));
		expect([...erlaubt].sort()).toEqual(['heute', 'kennzahlen', 'kz-termintreue']);
		// Kunden-Kachel aus → Filter leer
		await speichereKennzahlEinstellungen(kA(), { kunden_aktiv: { aktiv: false } }, HEUTE);
		expect((await kundenKennzahlen(kA(), ALLE(), GESAMT, { angebote: false }, HEUTE)).aus).toEqual(['kunden_aktiv']);
		expect((await kundenIdsFuer(kA(), ALLE(), GESAMT, 'aktiv', HEUTE)).size).toBe(0);
	});
});
