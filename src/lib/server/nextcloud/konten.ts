import { randomBytes } from 'node:crypto';
import { mitBetrieb, systemAbfrage, type Kontext } from '../db';
import { ApiFehler } from '../fehler';
import { hashe, SITZUNG_SEKUNDEN } from '../auth/sitzung';
import { meldeAn, type Weiter } from '../auth/vorsitzung';
import { nextcloud, type NextcloudKonfig } from './konfig';
import type { Identitaet } from './oidc';

/**
 * Zuordnung Nextcloud-Konto ↔ CRM-Benutzer und Anmeldung danach.
 *
 * - Vorrang hat die Verknüpfung über den Nextcloud-Benutzernamen, die ein Admin (Recht „Benutzer verwalten“) im CRM
 *   anlegt.
 * - Sonst (NEXTCLOUD_PER_EMAIL_VERKNUEPFEN, Standard ja): Nextcloud meldet eine BESTÄTIGTE E-Mail, und genau ein
 *   aktiver CRM-Benutzer dieses Betriebs hat sie → Verknüpfung entsteht bei der ersten Anmeldung.
 * - CRM-Benutzer werden nie automatisch angelegt. Plattform-Admins melden sich nie über Nextcloud an.
 * - Zwei-Faktor: NEXTCLOUD_2FA_VERTRAUEN=ja → Nextcloud hat 2FA erzwungen, die Sitzung gilt als bestätigt.
 *   Sonst verlangt das CRM seinen eigenen zweiten Faktor wie bei der Passwort-Anmeldung.
 */

let betriebZwischen: { id: string | null; bis: number } | null = null;

/** Betrieb der Anbindung: NEXTCLOUD_BETRIEB oder der einzige Betrieb der Installation (sonst null = aus). */
export async function anbindungsBetrieb(k: NextcloudKonfig, jetzt = Date.now()): Promise<string | null> {
	if (k.betrieb) return k.betrieb;
	if (betriebZwischen && betriebZwischen.bis > jetzt) return betriebZwischen.id;
	const [z] = await systemAbfrage((sql) => sql`select app.einziger_betrieb() as id`);
	betriebZwischen = { id: (z?.id as string | null) ?? null, bis: jetzt + 5 * 60_000 };
	return betriebZwischen.id;
}
/** Nur Tests. */
export const leereBetriebZwischenspeicher = () => (betriebZwischen = null);

export type SsoErgebnis = Weiter | { art: 'unbekannt' };

/** Nach geprüftem ID-Token: Sitzung bzw. Vor-Sitzung (CRM-2FA) – oder `unbekannt`, wenn kein CRM-Benutzer passt. */
export async function meldeUeberNextcloudAn(k: NextcloudKonfig, id: Identitaet): Promise<SsoErgebnis> {
	if (!k.anmeldung) return { art: 'verweigert' };
	const betrieb = await anbindungsBetrieb(k);
	if (!betrieb) return { art: 'unbekannt' };
	const [z] = await systemAbfrage(
		(sql) =>
			sql`select app.nextcloud_konto_finden(${betrieb}::uuid, ${id.sub}, ${id.email}, ${id.emailBestaetigt}, ${k.anmeldung!.perEmail}) as id`
	);
	const benutzer = (z?.id as string | null) ?? null;
	if (!benutzer) return { art: 'unbekannt' };
	if (!k.anmeldung.zweiFaktorVertrauen) return meldeAn(benutzer);
	const token = randomBytes(32).toString('base64url');
	const ablauf = new Date(Date.now() + SITZUNG_SEKUNDEN * 1000);
	const [s] = await systemAbfrage(
		(sql) => sql`select app.nextcloud_sitzung(${benutzer}::uuid, ${hashe(token)}::bytea, ${ablauf}::timestamptz) as ok`
	);
	return s?.ok === true ? { art: 'sitzung', token } : { art: 'verweigert' };
}

// ——— Verwaltung (Admin im Betrieb) ———

export type KontoZeile = {
	benutzerId: string;
	name: string;
	email: string;
	aktiv: boolean;
	ncBenutzer: string | null;
	art: 'admin' | 'email' | null;
	zuletztAngemeldet: string | null;
};

export async function listeVerknuepfungen(k: Kontext): Promise<KontoZeile[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select b.id, b.name, b.email::text as email, b.aktiv, n.nc_benutzer, n.art, n.zuletzt_angemeldet
			from app.benutzer b left join app.nextcloud_konten n on n.benutzer_id = b.id and n.betrieb_id = b.betrieb_id
			where b.betrieb_id = ${k.betriebId}
			order by b.name`;
		return z.map((r) => ({
			benutzerId: r.id,
			name: r.name,
			email: r.email,
			aktiv: r.aktiv,
			ncBenutzer: r.nc_benutzer,
			art: r.art,
			zuletztAngemeldet: r.zuletzt_angemeldet ? new Date(r.zuletzt_angemeldet).toISOString() : null
		}));
	});
}

/** Nextcloud-Benutzernamen: wie Nextcloud sie erlaubt (Buchstaben, Ziffern, Leerzeichen, _.@-'), max. 64. */
export const NC_BENUTZER = /^[A-Za-z0-9 _.@'-]{1,64}$/;

export async function verknuepfe(k: Kontext, benutzerId: string, ncBenutzerRoh: unknown): Promise<void> {
	const konfig = nextcloud();
	if (!konfig || (await anbindungsBetrieb(konfig)) !== k.betriebId) {
		throw new ApiFehler(403, 'Die Nextcloud-Anbindung ist für diesen Betrieb nicht eingerichtet.');
	}
	const nc = typeof ncBenutzerRoh === 'string' ? ncBenutzerRoh.trim() : '';
	if (!NC_BENUTZER.test(nc)) throw new ApiFehler(400, 'Bitte den Nextcloud-Benutzernamen angeben (wie bei der Nextcloud-Anmeldung).');
	await mitBetrieb(k, async (tx) => {
		const [b] = await tx`select id from app.benutzer where id = ${benutzerId} and betrieb_id = ${k.betriebId}`;
		if (!b) throw new ApiFehler(404, 'Benutzer nicht gefunden.');
		await tx`delete from app.nextcloud_konten where benutzer_id = ${benutzerId} and betrieb_id = ${k.betriebId}`;
		try {
			await tx`
				insert into app.nextcloud_konten (benutzer_id, betrieb_id, nc_benutzer, art, verknuepft_von)
				values (${benutzerId}, ${k.betriebId}, ${nc}, 'admin', ${k.benutzerId})`;
		} catch (e) {
			if ((e as { code?: string }).code === '23505') {
				throw new ApiFehler(409, 'Dieses Nextcloud-Konto ist schon mit einem anderen CRM-Benutzer verknüpft.');
			}
			throw e;
		}
	});
}

export async function loeseVerknuepfung(k: Kontext, benutzerId: string): Promise<void> {
	await mitBetrieb(k, (tx) => tx`delete from app.nextcloud_konten where benutzer_id = ${benutzerId} and betrieb_id = ${k.betriebId}`);
}

/** Nextcloud-Benutzername eines CRM-Benutzers (oder null). */
export async function ncBenutzerVon(k: Kontext, benutzerId: string): Promise<string | null> {
	const [z] = await mitBetrieb(k, (tx) => tx`select nc_benutzer from app.nextcloud_konten where benutzer_id = ${benutzerId} and betrieb_id = ${k.betriebId}`);
	return (z?.nc_benutzer as string | undefined) ?? null;
}
