import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext } from '../db';
import { UUID } from '../kunden';
import { LexwareFehler, type LexwareClient } from './client';
import { stelleEin, type Handler } from './warteschlange';

/**
 * Kunden ↔ Lexware-Kontakte (Plan Task T4; Migration 120). Felder nach https://developers.lexware.io/docs/ „Contacts“:
 * `person {salutation, firstName, lastName}` XOR `company {name, contactPersons[]}`, `roles.customer {}`,
 * `addresses.billing[{street, zip, city, countryCode}]`, `emailAddresses`/`phoneNumbers` (Listen je Art), `note`,
 * `version` (0 beim Anlegen, beim PUT die aktuelle – sonst 409).
 *
 * Das CRM führt bei Name, Adresse und Kontakt (Plan Frage 8). Jeder Kontakt trägt in `note` die Marke
 * „CRM-Kunde <id>“ – damit findet der Abgleich die Zuordnung sicher, und nach einer Zeitüberschreitung beim Anlegen
 * erkennt `vorhanden()` den schon entstandenen Kontakt (kein Doppel).
 */

export type KundeDaten = {
	id: string;
	art: 'privat' | 'firma';
	firma: string | null;
	anrede: string | null;
	vorname: string | null;
	nachname: string | null;
	email: string | null;
	telefon: string | null;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
};

export const markeFuer = (kundeId: string) => `CRM-Kunde ${kundeId}`;
const wert = (s: string | null | undefined, max: number) => {
	const t = (s ?? '').trim();
	return t ? t.slice(0, max) : null;
};

export function kontaktAusKunde(kd: KundeDaten, version = 0): Record<string, unknown> {
	const k: Record<string, unknown> = { version, roles: { customer: {} } };
	const vorname = wert(kd.vorname, 255);
	const nachname = wert(kd.nachname, 255);
	const email = wert(kd.email, 255);
	const telefon = wert(kd.telefon, 30);
	if (kd.art === 'firma') {
		const company: Record<string, unknown> = { name: wert(kd.firma, 255) };
		if (nachname) {
			const p: Record<string, unknown> = {};
			if (wert(kd.anrede, 25)) p.salutation = wert(kd.anrede, 25);
			if (vorname) p.firstName = vorname;
			p.lastName = nachname;
			p.primary = true;
			if (email) p.emailAddress = email;
			if (telefon) p.phoneNumber = telefon;
			company.contactPersons = [p];
		}
		k.company = company;
	} else {
		const person: Record<string, unknown> = {};
		if (wert(kd.anrede, 25)) person.salutation = wert(kd.anrede, 25);
		if (vorname) person.firstName = vorname;
		person.lastName = nachname;
		k.person = person;
	}
	if (kd.strasse || kd.plz || kd.ort) {
		const a: Record<string, unknown> = {};
		if (wert(kd.strasse, 255)) a.street = wert(kd.strasse, 255);
		if (wert(kd.plz, 20)) a.zip = wert(kd.plz, 20);
		if (wert(kd.ort, 255)) a.city = wert(kd.ort, 255);
		a.countryCode = 'DE';
		k.addresses = { billing: [a] };
	}
	const liste = kd.art === 'firma' ? 'business' : 'private';
	if (email) k.emailAddresses = { [liste]: [email] };
	if (telefon) k.phoneNumbers = { [liste]: [telefon] };
	k.note = markeFuer(kd.id);
	return k;
}

/** Gehört dieser Lexware-Kontakt zum Kunden? „marke“ (sicher) oder „email“ (gleiche Adresse), sonst null. */
export function passtZuKunde(kontakt: any, kd: { id: string; email: string | null }): 'marke' | 'email' | null {
	if (typeof kontakt?.note === 'string' && kontakt.note.includes(markeFuer(kd.id))) return 'marke';
	const mail = kd.email?.trim().toLowerCase();
	if (mail) {
		const alle = Object.values(kontakt?.emailAddresses ?? {}).flat() as unknown[];
		if (alle.some((e) => typeof e === 'string' && e.trim().toLowerCase() === mail)) return 'email';
	}
	return null;
}

async function ladeKunde(k: Kontext, id: string) {
	const [z] = await mitBetrieb(k, (tx) => tx`
		select id, art, firma, anrede, vorname, nachname, email::text, telefon, strasse, plz, ort, lexware_id, lexware_version, geaendert, lexware_stand
		from app.kunden where id = ${id} and betrieb_id = ${k.betriebId}`);
	return z as (KundeDaten & { lexware_id: string | null; lexware_version: number | null; geaendert: Date; lexware_stand: Date | null }) | undefined;
}

async function merkeVerknuepfung(k: Kontext, kundeId: string, lexwareId: string, version: number | null) {
	await mitBetrieb(k, (tx) => tx`
		update app.kunden set lexware_id = ${lexwareId}, lexware_version = ${version}, lexware_stand = now(), lexware_geaendert = false
		where id = ${kundeId} and betrieb_id = ${k.betriebId}`);
}

type Antwort = { id: string; version?: number };

export const kontaktAnlegen: Handler = {
	anlegend: true,
	async ausfuehren(c, n, k) {
		const kd = await ladeKunde(k, n.kundeId);
		if (!kd) return { ergebnis: { uebersprungen: 'Kunde gelöscht' } };
		if (kd.lexware_id) return { lexwareId: kd.lexware_id, ergebnis: { schonVerknuepft: true } };
		const r = await c.post<Antwort>('/v1/contacts', kontaktAusKunde(kd));
		return { lexwareId: r.id, ergebnis: { version: r.version ?? null } };
	},
	async vorhanden(c, n, k) {
		const kd = await ladeKunde(k, n.kundeId);
		if (!kd) return null;
		const name = kd.art === 'firma' ? kd.firma : kd.nachname;
		const filter = name && name.trim().length >= 3 ? `name=${encodeURIComponent(name.trim())}` : kd.email && kd.email.length >= 3 ? `email=${encodeURIComponent(kd.email)}` : null;
		if (!filter) return null;
		for (let seite = 0; seite < 20; seite++) {
			const r = await c.get<{ content: any[]; last: boolean }>(`/v1/contacts?${filter}&page=${seite}&size=100`);
			const treffer = r.content.find((x) => passtZuKunde(x, { id: kd.id, email: null }) === 'marke');
			if (treffer) return treffer.id as string;
			if (r.last) break;
		}
		return null;
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		const version = typeof r.ergebnis?.version === 'number' ? (r.ergebnis.version as number) : null;
		await merkeVerknuepfung(k, n.kundeId, r.lexwareId, version);
	}
};

/** Felder, die das CRM führt, in den gelesenen Kontakt übernehmen (Rollen, Kundennummer usw. bleiben). */
function zusammenfuehren(alt: any, kd: KundeDaten): Record<string, unknown> {
	const neu = kontaktAusKunde(kd, alt.version);
	const ergebnis: Record<string, unknown> = { ...alt, ...neu, roles: { ...(alt.roles ?? {}), customer: alt.roles?.customer ?? {} } };
	if (kd.art === 'firma') delete ergebnis.person;
	else delete ergebnis.company;
	const notiz = typeof alt.note === 'string' ? alt.note : '';
	ergebnis.note = notiz.includes(markeFuer(kd.id)) ? notiz : [notiz, markeFuer(kd.id)].filter(Boolean).join('\n').slice(0, 1000);
	for (const f of ['id', 'organizationId', 'archived']) delete ergebnis[f];
	return ergebnis;
}

export const kontaktAktualisieren: Handler = {
	async ausfuehren(c, n, k) {
		const kd = await ladeKunde(k, n.kundeId);
		if (!kd?.lexware_id) return { ergebnis: { uebersprungen: 'nicht verknüpft' } };
		if (!UUID.test(kd.lexware_id)) throw new Error('ungültige Lexware-ID');
		for (let versuch = 0; ; versuch++) {
			const alt = await c.get<any>(`/v1/contacts/${kd.lexware_id}`);
			try {
				const r = await c.put<Antwort>(`/v1/contacts/${kd.lexware_id}`, zusammenfuehren(alt, kd));
				return { lexwareId: kd.lexware_id, ergebnis: { version: r.version ?? null } };
			} catch (e) {
				// Versionskonflikt: jemand hat in Lexware gleichzeitig geändert → einmal neu lesen
				if (e instanceof LexwareFehler && e.art === 'konflikt' && versuch === 0) continue;
				throw e;
			}
		}
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		await merkeVerknuepfung(k, n.kundeId, r.lexwareId, typeof r.ergebnis?.version === 'number' ? (r.ergebnis.version as number) : null);
	}
};

/**
 * Abgleich aller Kunden: Lexware-Kontakte (Kundenrolle) seitenweise lesen, unverknüpfte CRM-Kunden per Marke oder
 * eindeutiger E-Mail verknüpfen. Danach: im CRM geänderte, verknüpfte Kunden → „aktualisieren“; fehlende Kunden nur
 * mit Schalter „fehlende Kunden in Lexware anlegen“ → „anlegen“.
 */
export const kontakteAbgleichen: Handler = {
	async ausfuehren(c, _n, k) {
		const kunden = await mitBetrieb(k, (tx) => tx`
			select id, email::text, lexware_id, geaendert, lexware_stand from app.kunden where betrieb_id = ${k.betriebId}`);
		const offen = new Map(kunden.filter((x) => !x.lexware_id).map((x) => [x.id as string, x]));
		const verknuepft = new Set(kunden.filter((x) => x.lexware_id).map((x) => x.lexware_id as string));
		const nachMail = new Map<string, string[]>();
		for (const x of offen.values()) if (x.email) nachMail.set(x.email.toLowerCase(), [...(nachMail.get(x.email.toLowerCase()) ?? []), x.id]);
		let gelesen = 0;
		let neuVerknuepft = 0;
		for (let seite = 0; seite < 200; seite++) {
			const r = await c.get<{ content: any[]; last: boolean }>(`/v1/contacts?customer=true&page=${seite}&size=100`);
			for (const kontakt of r.content) {
				gelesen++;
				if (typeof kontakt?.id !== 'string' || !UUID.test(kontakt.id) || verknuepft.has(kontakt.id)) continue;
				const marke = typeof kontakt.note === 'string' ? /CRM-Kunde ([0-9a-f-]{36})/i.exec(kontakt.note)?.[1] : undefined;
				let kundeId = marke && offen.has(marke) ? marke : null;
				if (!kundeId) {
					const mails = (Object.values(kontakt.emailAddresses ?? {}).flat() as unknown[]).filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase());
					const kandidaten = [...new Set(mails.flatMap((m) => nachMail.get(m) ?? []))].filter((id) => offen.has(id));
					if (kandidaten.length === 1) kundeId = kandidaten[0];
				}
				if (!kundeId) continue;
				await merkeVerknuepfung(k, kundeId, kontakt.id, typeof kontakt.version === 'number' ? kontakt.version : null);
				offen.delete(kundeId);
				verknuepft.add(kontakt.id);
				neuVerknuepft++;
			}
			if (r.last || r.content.length === 0) break;
		}
		// geänderte, verknüpfte Kunden → aktualisieren
		let aktualisieren = 0;
		for (const x of kunden) {
			if (!x.lexware_id || (x.lexware_stand && new Date(x.geaendert) <= new Date(x.lexware_stand))) continue;
			if ((await stelleEin(k, { art: 'kontakt_aktualisieren', nutzlast: { kundeId: x.id }, idempotenz: `kontakt_aktualisieren:${x.id}:${new Date(x.geaendert).getTime()}` })).neu) aktualisieren++;
		}
		let anlegen = 0;
		const [cfg] = await mitBetrieb(k, (tx) => tx`select kunden_anlegen from app.lexware_konfig where betrieb_id = ${k.betriebId}`);
		if (cfg?.kunden_anlegen)
			for (const id of offen.keys()) if ((await stelleEin(k, { art: 'kontakt_anlegen', nutzlast: { kundeId: id }, idempotenz: `kontakt_anlegen:${id}` })).neu) anlegen++;
		return { ergebnis: { gelesen, neuVerknuepft, aktualisieren, anlegen, ohneLexware: offen.size - anlegen } };
	}
};

// ——— für Oberfläche und Sprache ———

/** Kunde nach Lexware übertragen: neu anlegen oder (verknüpft) aktualisieren – über die Warteschlange. */
export async function kundeNachLexware(k: Kontext, kundeId: unknown): Promise<{ id: string; neu: boolean; art: 'kontakt_anlegen' | 'kontakt_aktualisieren' }> {
	if (typeof kundeId !== 'string' || !UUID.test(kundeId)) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	const kd = await ladeKunde(k, kundeId);
	if (!kd) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	if (kd.lexware_id) {
		const r = await stelleEin(k, { art: 'kontakt_aktualisieren', nutzlast: { kundeId }, idempotenz: `kontakt_aktualisieren:${kundeId}:${new Date(kd.geaendert).getTime()}` });
		return { ...r, art: 'kontakt_aktualisieren' };
	}
	const r = await stelleEin(k, { art: 'kontakt_anlegen', nutzlast: { kundeId }, idempotenz: `kontakt_anlegen:${kundeId}` });
	return { ...r, art: 'kontakt_anlegen' };
}

export type KundeLexwareStand = { verknuepft: boolean; lexwareId: string | null; aktuell: boolean; inArbeit: boolean; problem: string | null; geaendertInLexware: boolean; stand: string | null };

export async function kundeLexwareStand(k: Kontext, kundeId: string): Promise<KundeLexwareStand> {
	const kd = await ladeKunde(k, kundeId);
	if (!kd) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	const [z] = await mitBetrieb(k, (tx) => tx`
		select (select lexware_geaendert from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}) as geaendert_lx,
			(select count(*)::int from app.lexware_auftraege where betrieb_id = ${k.betriebId} and nutzlast ->> 'kundeId' = ${kundeId}
				and status in ('wartet', 'laeuft', 'ungewiss')) as offen,
			(select letzter_fehler from app.lexware_auftraege where betrieb_id = ${k.betriebId} and nutzlast ->> 'kundeId' = ${kundeId}
				and status = 'pruefen' order by angelegt desc limit 1) as problem`);
	return {
		verknuepft: !!kd.lexware_id,
		lexwareId: kd.lexware_id,
		aktuell: !!kd.lexware_id && !!kd.lexware_stand && new Date(kd.geaendert) <= new Date(kd.lexware_stand),
		inArbeit: z.offen > 0,
		problem: z.problem ?? null,
		geaendertInLexware: !!z.geaendert_lx,
		stand: kd.lexware_stand ? new Date(kd.lexware_stand).toISOString() : null
	};
}

/** „Kunden abgleichen“ (Knopf, Sprache): höchstens ein Abgleich je Minute. */
export async function starteKundenAbgleich(k: Kontext): Promise<{ id: string; neu: boolean }> {
	return stelleEin(k, { art: 'kontakte_abgleichen', idempotenz: `kontakte_abgleichen:${new Date().toISOString().slice(0, 16)}` });
}

/** § 13b UStG (nur Firmenkunden): Bauleister mit Bescheinigung (gültig bis). */
export async function setze13b(k: Kontext, kundeId: unknown, e: { bauleister: unknown; bis?: unknown }): Promise<void> {
	if (typeof kundeId !== 'string' || !UUID.test(kundeId)) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	const bauleister = e.bauleister === true;
	const bis = typeof e.bis === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.bis) ? e.bis : null;
	if (bauleister && !bis) throw new ApiFehler(400, '§ 13b: Bitte angeben, bis wann die Bescheinigung des Finanzamts gilt.');
	try {
		const z = await mitBetrieb(k, (tx) => tx`
			update app.kunden set bauleister_13b = ${bauleister}, bescheinigung_13b_bis = ${bauleister ? bis : null}
			where id = ${kundeId} and betrieb_id = ${k.betriebId} returning id`);
		if (z.length === 0) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	} catch (err) {
		if ((err as { code?: string }).code === '23514') throw new ApiFehler(400, '§ 13b gilt nur für Firmenkunden.');
		throw err;
	}
}
