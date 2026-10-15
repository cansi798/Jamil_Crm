import { createHash, randomBytes } from 'node:crypto';
import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { pruefeEinstellungenVerwalter, sperreEinstellungenPruefung } from './rollen';
import { pruefeGrenze } from './tarif';

/**
 * Benutzerverwaltung und Einladungen eines Betriebs (Recht `benutzer.verwalten`), gemeinsam genutzt von der API
 * (`/api/benutzer`, `/api/einladungen`) und der Seite `/einstellungen/benutzer`. Alles läuft als `crm_app` in
 * `mitBetrieb` (RLS: nur der eigene Betrieb). Neue Benutzer entstehen nie hier, sondern nur bei der Annahme einer
 * Einladung (`auth/einladung.ts`, SECURITY-DEFINER-Funktion für `crm_auth`).
 *
 * Wer `einstellungen` nicht hat, darf niemanden (auch sich selbst nicht) in eine Rolle mit Rechten setzen oder
 * einladen, die er selbst nicht hat – und Benutzer mit solchen Rechten auch nicht ändern oder deaktivieren.
 */

export type BenutzerZeile = {
	id: string;
	name: string;
	email: string;
	aktiv: boolean;
	rolleId: string | null;
	rolleName: string | null;
	letzteAktivitaet: string | null;
};

export type EinladungZeile = {
	id: string;
	email: string;
	rolleId: string;
	rolleName: string;
	laeuftAb: string;
};

export type RolleAuswahl = { id: string; name: string; rechte: string[]; vergebbar: boolean };

export const EINLADUNG_TAGE = 7;
const EMAIL_MAX = 254;
// bewusst einfach: etwas@etwas.etwas ohne Leerzeichen; die eigentliche Prüfung ist, dass die Person den Link erhält
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MELDUNG_REGISTRIERT = 'Diese E-Mail ist bereits registriert.';
export const MELDUNG_DOPPELTE_EINLADUNG = 'Für diese E-Mail gibt es bereits eine offene Einladung.';
export const MELDUNG_ROLLE_ZU_HOCH = 'Sie können nur Rollen vergeben, deren Rechte Sie selbst haben.';
export const MELDUNG_BENUTZER_ZU_HOCH =
	'Diesen Benutzer können Sie nicht ändern, weil er Rechte hat, die Sie selbst nicht haben.';

/** Darf jemand mit `akteurRechte` eine Rolle mit `rolleRechte` vergeben (bzw. jemanden mit diesen Rechten ändern)? */
export function darfRechteVergeben(akteurRechte: readonly string[], rolleRechte: readonly string[]): boolean {
	if (akteurRechte.includes('einstellungen')) return true;
	return rolleRechte.every((r) => akteurRechte.includes(r));
}

export function pruefeEmail(wert: unknown): string {
	const email = typeof wert === 'string' ? wert.trim().toLowerCase() : '';
	if (email.length > EMAIL_MAX || !EMAIL_MUSTER.test(email)) {
		throw new ApiFehler(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
	}
	return email;
}

function pruefeRolleId(wert: unknown): string {
	if (typeof wert !== 'string' || !UUID.test(wert)) throw new ApiFehler(400, 'Bitte eine Rolle wählen.');
	return wert;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export function listeBenutzer(k: Kontext): Promise<BenutzerZeile[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select b.id, b.name, b.email::text as email, b.aktiv, b.rolle_id, r.name as rolle_name,
				b.letzte_aktivitaet
			from app.benutzer b
			left join app.rollen r on r.id = b.rolle_id
			order by b.aktiv desc, b.name, b.id`;
		return z.map((b) => ({
			id: b.id,
			name: b.name,
			email: b.email,
			aktiv: b.aktiv,
			rolleId: b.rolle_id,
			rolleName: b.rolle_name,
			letzteAktivitaet: b.letzte_aktivitaet ? new Date(b.letzte_aktivitaet).toISOString() : null
		}));
	});
}

/** Offene (nicht angenommene, nicht abgelaufene) Einladungen. Token und Hash verlassen die Datenbank nie. */
export function listeEinladungen(k: Kontext): Promise<EinladungZeile[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select e.id, e.email::text as email, e.rolle_id, r.name as rolle_name, e.laeuft_ab
			from app.einladungen e
			join app.rollen r on r.id = e.rolle_id
			where e.angenommen is null and e.laeuft_ab > now()
			order by e.angelegt desc, e.id`;
		return z.map((e) => ({
			id: e.id,
			email: e.email,
			rolleId: e.rolle_id,
			rolleName: e.rolle_name,
			laeuftAb: new Date(e.laeuft_ab).toISOString()
		}));
	});
}

/** Rollen des Betriebs für Auswahllisten; `vergebbar` nach der Regel von `darfRechteVergeben`. */
export function rollenZurAuswahl(k: Kontext, akteurRechte: readonly string[]): Promise<RolleAuswahl[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`select id, name, rechte from app.rollen order by name, id`;
		return z.map((r) => ({
			id: r.id,
			name: r.name,
			rechte: r.rechte,
			vergebbar: darfRechteVergeben(akteurRechte, r.rechte)
		}));
	});
}

/**
 * Lädt eine E-Mail in eine Rolle ein und liefert das Token (nur hier im Klartext; gespeichert wird der SHA-256).
 * Eine bereits offene Einladung derselben E-Mail in diesem Betrieb wird ersetzt. Die Benutzergrenze wird in
 * derselben Transaktion geprüft (offene Einladungen belegen einen Platz). Es wird keine E-Mail verschickt.
 */
export async function ladeEin(
	k: Kontext,
	akteurRechte: readonly string[],
	eingabe: { email?: unknown; rolleId?: unknown }
): Promise<{ token: string; email: string; laeuftAb: string }> {
	const email = pruefeEmail(eingabe.email);
	const rolleId = pruefeRolleId(eingabe.rolleId);
	const token = randomBytes(32).toString('base64url');
	try {
		return await legeEinladungAn(k, akteurRechte, email, rolleId, token);
	} catch (e) {
		// Zwei gleichzeitige Einladungen derselben E-Mail: die zweite scheitert an der eindeutigen Prüfung
		// einladungen_offen_email_idx (die Transaktion ist dann zurückgerollt, die erste Einladung bleibt bestehen).
		const f = e as { code?: string; constraint_name?: string };
		if (f.code === '23505' && f.constraint_name === 'einladungen_offen_email_idx') {
			throw new ApiFehler(409, MELDUNG_DOPPELTE_EINLADUNG);
		}
		throw e;
	}
}

function legeEinladungAn(
	k: Kontext,
	akteurRechte: readonly string[],
	email: string,
	rolleId: string,
	token: string
): Promise<{ token: string; email: string; laeuftAb: string }> {
	return mitBetrieb(k, async (tx) => {
		const [rolle] = await tx`select id, rechte from app.rollen where id = ${rolleId}`;
		if (!rolle) throw new ApiFehler(400, 'Rolle nicht gefunden.');
		if (!darfRechteVergeben(akteurRechte, rolle.rechte)) throw new ApiFehler(403, MELDUNG_ROLLE_ZU_HOCH);
		const [{ vergeben }] = await tx`select app.email_vergeben(${email}) as vergeben`;
		if (vergeben) throw new ApiFehler(409, MELDUNG_REGISTRIERT);
		// erst die alte Einladung entfernen (sie belegt sonst einen Platz), dann die Grenze prüfen – alles in einer
		// Transaktion: Scheitert die Prüfung, bleibt die alte Einladung bestehen.
		await tx`delete from app.einladungen where email = ${email} and angenommen is null`;
		await pruefeGrenze(k.betriebId, 'benutzer', tx);
		const [neu] = await tx`
			insert into app.einladungen (betrieb_id, email, rolle_id, token_hash, eingeladen_von)
			values (${k.betriebId}, ${email}, ${rolleId}, ${sha256(token)}, ${k.benutzerId})
			returning laeuft_ab`;
		return { token, email, laeuftAb: new Date(neu.laeuft_ab).toISOString() };
	});
}

/** Widerruft eine offene Einladung des eigenen Betriebs (404, wenn es sie nicht gibt). */
export function widerrufeEinladung(k: Kontext, id: string): Promise<void> {
	if (!UUID.test(id)) throw new ApiFehler(404, 'Einladung nicht gefunden.');
	return mitBetrieb(k, async (tx) => {
		const r = await tx`delete from app.einladungen where id = ${id} and angenommen is null`;
		if (r.count === 0) throw new ApiFehler(404, 'Einladung nicht gefunden.');
	});
}

export type BenutzerAenderung = { rolleId?: unknown; aktiv?: unknown };

/**
 * Ändert Rolle und/oder Aktiv-Status eines Benutzers des eigenen Betriebs.
 * - Schutzregel (409): Danach muss noch ein aktiver Benutzer die Einstellungen verwalten können.
 * - Deaktivieren beendet alle Sitzungen des Benutzers; sich selbst deaktivieren geht nicht.
 * - Wechsel in eine Rolle mit 'einstellungen' beendet seine Sitzungen (zweiter Faktor wird sofort Pflicht).
 * - Reaktivieren prüft die Benutzergrenze.
 */
export function aendereBenutzer(
	k: Kontext,
	akteurRechte: readonly string[],
	id: string,
	eingabe: BenutzerAenderung
): Promise<{ id: string; rolleId: string | null; aktiv: boolean }> {
	if (!UUID.test(id)) throw new ApiFehler(404, 'Benutzer nicht gefunden.');
	if (eingabe.rolleId === undefined && eingabe.aktiv === undefined) {
		throw new ApiFehler(400, 'Nichts zu ändern: Rolle oder Aktiv-Status angeben.');
	}
	const rolleId = eingabe.rolleId !== undefined ? pruefeRolleId(eingabe.rolleId) : undefined;
	if (eingabe.aktiv !== undefined && typeof eingabe.aktiv !== 'boolean') {
		throw new ApiFehler(400, 'Aktiv-Status muss true oder false sein.');
	}
	const aktiv = eingabe.aktiv as boolean | undefined;
	if (aktiv === false && id === k.benutzerId) {
		throw new ApiFehler(400, 'Sie können sich nicht selbst deaktivieren.');
	}

	return mitBetrieb(k, async (tx) => {
		await sperreEinstellungenPruefung(tx, k.betriebId);
		const [alt] = await tx`
			select b.id, b.rolle_id, b.aktiv, coalesce(r.rechte, '{}'::text[]) as rechte
			from app.benutzer b
			left join app.rollen r on r.id = b.rolle_id
			where b.id = ${id}
			for update of b`;
		if (!alt) throw new ApiFehler(404, 'Benutzer nicht gefunden.');
		if (!darfRechteVergeben(akteurRechte, alt.rechte)) throw new ApiFehler(403, MELDUNG_BENUTZER_ZU_HOCH);

		let neueRechte: string[] = alt.rechte;
		if (rolleId !== undefined) {
			const [rolle] = await tx`select id, rechte from app.rollen where id = ${rolleId}`;
			if (!rolle) throw new ApiFehler(400, 'Rolle nicht gefunden.');
			if (!darfRechteVergeben(akteurRechte, rolle.rechte)) throw new ApiFehler(403, MELDUNG_ROLLE_ZU_HOCH);
			neueRechte = rolle.rechte;
		}
		if (aktiv === true && !alt.aktiv) await pruefeGrenze(k.betriebId, 'benutzer', tx);

		const [neu] = await tx`
			update app.benutzer
			set rolle_id = ${rolleId ?? alt.rolle_id}, aktiv = ${aktiv ?? alt.aktiv}
			where id = ${id}
			returning id, rolle_id, aktiv`;
		await pruefeEinstellungenVerwalter(tx);

		const bekommtEinstellungen = !alt.rechte.includes('einstellungen') && neueRechte.includes('einstellungen');
		if (neu.aktiv === false || bekommtEinstellungen) {
			await tx`select app.sitzungen_beenden_fuer_benutzer(${id}::uuid)`;
		}
		return { id: neu.id, rolleId: neu.rolle_id, aktiv: neu.aktiv };
	});
}
