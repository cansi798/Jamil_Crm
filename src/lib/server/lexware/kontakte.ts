import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext } from '../db';
import { UUID } from '../kunden';
import { LexwareFehler, type LexwareClient } from './client';
import { stelleEin, type Handler } from './warteschlange';
import { adresseLand, suchText } from './land';

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
	/** Migration 125: Land (ISO alpha-2), USt-IdNr., Steuernummer – optional, damit ältere Aufrufer weiter passen */
	land?: string | null;
	ustId?: string | null;
	steuernummer?: string | null;
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
	const telefon = wert(kd.telefon, 50);
	if (kd.art === 'firma') {
		const company: Record<string, unknown> = { name: wert(kd.firma, 255) };
		// Steuerdaten (Doku „Contacts“ → Company Details: vatRegistrationId, taxNumber); USt-ID ist für § 13b Pflicht
		if (wert(kd.ustId, 30)) company.vatRegistrationId = wert(kd.ustId, 30);
		if (wert(kd.steuernummer, 30)) company.taxNumber = wert(kd.steuernummer, 30);
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
		// Land am Kunden (Migration 125), sonst Länder-Präfix der PLZ, sonst DE (Doku „Contacts“ → Address: countryCode Pflicht)
		const land = adresseLand(kd.land, kd.plz);
		if (wert(kd.strasse, 255)) a.street = wert(kd.strasse, 255);
		if (wert(land.zip, 20)) a.zip = wert(land.zip, 20);
		if (wert(kd.ort, 255)) a.city = wert(kd.ort, 255);
		a.countryCode = land.countryCode;
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
		select id, art, firma, anrede, vorname, nachname, email::text, telefon, strasse, plz, ort, land, ust_id as "ustId", steuernummer,
			lexware_id, lexware_version, geaendert, lexware_stand, lexware_kundennummer
		from app.kunden where id = ${id} and betrieb_id = ${k.betriebId}`);
	return z as (KundeDaten & { lexware_id: string | null; lexware_version: number | null; geaendert: Date; lexware_stand: Date | null; lexware_kundennummer: number | null }) | undefined;
}

/**
 * Kundennummer aus einem Lexware-Kontakt (Doku „Contacts“ → Roles Details: `roles.customer.number`, Integer, von Lexware
 * vergeben, nicht setz- oder änderbar). Fehlt sie (z. B. Kontakt ohne Kundenrolle), → null.
 */
export function kundennummerAus(kontakt: unknown): number | null {
	const n = (kontakt as { roles?: { customer?: { number?: unknown } } } | null)?.roles?.customer?.number;
	return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** Lexware-Kundennummer am Kunden merken (eindeutig je Betrieb; Konflikt → Nummer nicht übernehmen, nur melden). */
export async function merkeKundennummer(k: Kontext, kundeId: string, nummer: number | null): Promise<void> {
	if (nummer === null) return;
	try {
		await mitBetrieb(k, (tx) => tx`
			update app.kunden set lexware_kundennummer = ${nummer}
			where id = ${kundeId} and betrieb_id = ${k.betriebId} and lexware_kundennummer is distinct from ${nummer}`);
	} catch (e) {
		if ((e as { code?: string }).code !== '23505') throw e;
		console.warn(`Lexware: Kundennummer ${nummer} gehört im CRM schon einem anderen Kunden – nicht übernommen (Kunde ${kundeId.slice(0, 8)}…)`);
	}
}

async function merkeVerknuepfung(k: Kontext, kundeId: string, lexwareId: string, version: number | null, nummer: number | null = null) {
	await mitBetrieb(k, (tx) => tx`
		update app.kunden set lexware_id = ${lexwareId}, lexware_version = ${version}, lexware_stand = now(), lexware_geaendert = false
		where id = ${kundeId} and betrieb_id = ${k.betriebId}`);
	await merkeKundennummer(k, kundeId, nummer);
}

type Antwort = { id: string; version?: number };

export const kontaktAnlegen: Handler = {
	anlegend: true,
	async ausfuehren(c, n, k) {
		const kd = await ladeKunde(k, n.kundeId);
		if (!kd) return { ergebnis: { uebersprungen: 'Kunde gelöscht' } };
		if (kd.lexware_id) return { lexwareId: kd.lexware_id, ergebnis: { schonVerknuepft: true } };
		const r = await c.post<Antwort>('/v1/contacts', kontaktAusKunde(kd));
		// Die Kundennummer steht nicht in der POST-Antwort (Doku „Create a Contact“), nur im Kontakt selbst → einmal lesen
		const nummer = await c.get<unknown>(`/v1/contacts/${r.id}`).then(kundennummerAus, () => null);
		return { lexwareId: r.id, ergebnis: { version: r.version ?? null, nummer } };
	},
	async vorhanden(c, n, k) {
		const kd = await ladeKunde(k, n.kundeId);
		if (!kd) return null;
		const name = kd.art === 'firma' ? kd.firma : kd.nachname;
		// Suchtext: &, <, > HTML-kodiert und URL-kodiert (Doku → FAQ „Search String Encoding“), sonst findet „Müller & Söhne“ nichts
		const filter = name && name.trim().length >= 3 ? `name=${suchText(name.trim())}` : kd.email && kd.email.length >= 3 ? `email=${suchText(kd.email)}` : null;
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
		const nummer = typeof r.ergebnis?.nummer === 'number' ? (r.ergebnis.nummer as number) : null;
		await merkeVerknuepfung(k, n.kundeId, r.lexwareId, version, nummer);
		// nach Zeitüberschreitung gefunden (ohne Nummer): einmal lesen + CRM-Stand senden – dabei kommt die Nummer mit
		if (nummer === null) await stelleEin(k, { art: 'kontakt_aktualisieren', nutzlast: { kundeId: n.kundeId }, idempotenz: `kontakt_aktualisieren:${n.kundeId}:nummer` });
	}
};

/** Felder, die das CRM führt, in den gelesenen Kontakt übernehmen (Rollen, Kundennummer usw. bleiben). */
function zusammenfuehren(alt: any, kd: KundeDaten): Record<string, unknown> {
	const neu = kontaktAusKunde(kd, alt.version);
	const ergebnis: Record<string, unknown> = { ...alt, ...neu, roles: { ...(alt.roles ?? {}), customer: alt.roles?.customer ?? {} } };
	if (kd.art === 'firma') {
		delete ergebnis.person;
		// Lexware-eigene Firmenfelder (z. B. allowTaxFreeInvoices) behalten; Name, Ansprechperson und Steuerdaten führt das CRM
		const c: Record<string, unknown> = { ...(alt.company ?? {}), ...(neu.company as Record<string, unknown>) };
		for (const f of ['vatRegistrationId', 'taxNumber']) if (!(f in (neu.company as Record<string, unknown>))) delete c[f];
		ergebnis.company = c;
	} else delete ergebnis.company;
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
				return { lexwareId: kd.lexware_id, ergebnis: { version: r.version ?? null, nummer: kundennummerAus(alt) } };
			} catch (e) {
				// Versionskonflikt: jemand hat in Lexware gleichzeitig geändert → einmal neu lesen
				if (e instanceof LexwareFehler && e.art === 'konflikt' && versuch === 0) continue;
				throw e;
			}
		}
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		await merkeVerknuepfung(k, n.kundeId, r.lexwareId, typeof r.ergebnis?.version === 'number' ? (r.ergebnis.version as number) : null,
			typeof r.ergebnis?.nummer === 'number' ? (r.ergebnis.nummer as number) : null);
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
			select id, email::text, lexware_id, geaendert, lexware_stand, lexware_kundennummer from app.kunden where betrieb_id = ${k.betriebId}`);
		const offen = new Map(kunden.filter((x) => !x.lexware_id).map((x) => [x.id as string, x]));
		const verknuepft = new Set(kunden.filter((x) => x.lexware_id).map((x) => x.lexware_id as string));
		// Kundennummern (Can #6748): je verknüpftem Kontakt die Nummer aus Lexware übernehmen, wenn sie fehlt/abweicht
		const kundeZuKontakt = new Map(kunden.filter((x) => x.lexware_id).map((x) => [x.lexware_id as string, x]));
		const neueNummern: { kundeId: string; nummer: number }[] = [];
		const neuVerknuepftIds: string[] = [];
		const nachMail = new Map<string, string[]>();
		for (const x of offen.values()) if (x.email) nachMail.set(x.email.toLowerCase(), [...(nachMail.get(x.email.toLowerCase()) ?? []), x.id]);
		let gelesen = 0;
		let neuVerknuepft = 0;
		for (let seite = 0; seite < 200; seite++) {
			const r = await c.get<{ content: any[]; last: boolean }>(`/v1/contacts?customer=true&page=${seite}&size=100`);
			for (const kontakt of r.content) {
				gelesen++;
				if (typeof kontakt?.id !== 'string' || !UUID.test(kontakt.id)) continue;
				if (verknuepft.has(kontakt.id)) {
					const kd = kundeZuKontakt.get(kontakt.id);
					const nr = kundennummerAus(kontakt);
					if (kd && nr !== null && Number(kd.lexware_kundennummer ?? 0) !== nr) neueNummern.push({ kundeId: kd.id, nummer: nr });
					continue;
				}
				const marke = typeof kontakt.note === 'string' ? /CRM-Kunde ([0-9a-f-]{36})/i.exec(kontakt.note)?.[1] : undefined;
				let kundeId = marke && offen.has(marke) ? marke : null;
				if (!kundeId) {
					const mails = (Object.values(kontakt.emailAddresses ?? {}).flat() as unknown[]).filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase());
					const kandidaten = [...new Set(mails.flatMap((m) => nachMail.get(m) ?? []))].filter((id) => offen.has(id));
					if (kandidaten.length === 1) kundeId = kandidaten[0];
				}
				if (!kundeId) continue;
				await merkeVerknuepfung(k, kundeId, kontakt.id, typeof kontakt.version === 'number' ? kontakt.version : null, kundennummerAus(kontakt));
				offen.delete(kundeId);
				verknuepft.add(kontakt.id);
				neuVerknuepftIds.push(kundeId);
				neuVerknuepft++;
			}
			if (r.last || r.content.length === 0) break;
		}
		for (const x of neueNummern) await merkeKundennummer(k, x.kundeId, x.nummer);
		// geänderte, verknüpfte Kunden → aktualisieren
		let aktualisieren = 0;
		// Neu verknüpfte Kunden: das CRM führt – die CRM-Daten einmal nach Lexware übertragen (sonst gälten sie durch das
		// Verknüpfen als „schon übertragen“, Prüfbericht 21.11.2026)
		for (const id of neuVerknuepftIds)
			if ((await stelleEin(k, { art: 'kontakt_aktualisieren', nutzlast: { kundeId: id }, idempotenz: `kontakt_aktualisieren:${id}:verknuepft` })).neu) aktualisieren++;
		for (const x of kunden) {
			if (!x.lexware_id || (x.lexware_stand && new Date(x.geaendert) <= new Date(x.lexware_stand))) continue;
			if ((await stelleEin(k, { art: 'kontakt_aktualisieren', nutzlast: { kundeId: x.id }, idempotenz: `kontakt_aktualisieren:${x.id}:${new Date(x.geaendert).getTime()}` })).neu) aktualisieren++;
		}
		let anlegen = 0;
		const [cfg] = await mitBetrieb(k, (tx) => tx`select kunden_anlegen from app.lexware_konfig where betrieb_id = ${k.betriebId}`);
		if (cfg?.kunden_anlegen)
			for (const id of offen.keys()) if ((await stelleEin(k, { art: 'kontakt_anlegen', nutzlast: { kundeId: id }, idempotenz: `kontakt_anlegen:${id}` })).neu) anlegen++;
		return { ergebnis: { gelesen, neuVerknuepft, aktualisieren, anlegen, ohneLexware: offen.size - anlegen, kundennummern: neueNummern.length } };
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

/**
 * Lexware-Kundennummer als Kundennummer im CRM (Can #6748, Plan a + d), läuft im Hintergrund-Dienst:
 * - einmaliger Abgleich aller Kunden, sobald die Verbindung steht (verknüpfen + Nummern holen; je Betrieb genau einmal
 *   über den Idempotenz-Schlüssel),
 * - neu angelegte Kunden (seit `kunden_auto_seit`) legt das CRM selbst in Lexware an und holt die Nummer zurück.
 * Ältere Kunden ohne Treffer legt weiter nur der Schalter „fehlende Kunden in Lexware anlegen“ an (sonst Doppel in Lexware).
 */
export async function kundennummernPflege(k: Kontext, max = 20): Promise<{ abgleich: boolean; angelegt: number }> {
	const [cfg] = await mitBetrieb(k, (tx) => tx`select status, kunden_auto_seit from app.lexware_konfig where betrieb_id = ${k.betriebId}`);
	if (cfg?.status !== 'verbunden') return { abgleich: false, angelegt: 0 };
	if (!cfg.kunden_auto_seit) await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set kunden_auto_seit = now() where betrieb_id = ${k.betriebId} and kunden_auto_seit is null`);
	const abgleich = (await stelleEin(k, { art: 'kontakte_abgleichen', idempotenz: 'kontakte_abgleichen:kundennummern' })).neu;
	if (!cfg.kunden_auto_seit) return { abgleich, angelegt: 0 };
	const neu = await mitBetrieb(k, (tx) => tx`
		select kd.id from app.kunden kd
		where kd.betrieb_id = ${k.betriebId} and kd.lexware_id is null and kd.angelegt >= ${cfg.kunden_auto_seit}
			and not exists (select 1 from app.lexware_auftraege q where q.betrieb_id = kd.betrieb_id and q.idempotenz = 'kontakt_anlegen:' || kd.id::text)
		order by kd.angelegt limit ${max}`);
	let angelegt = 0;
	for (const x of neu) if ((await stelleEin(k, { art: 'kontakt_anlegen', nutzlast: { kundeId: x.id }, idempotenz: `kontakt_anlegen:${x.id}` })).neu) angelegt++;
	return { abgleich, angelegt };
}
