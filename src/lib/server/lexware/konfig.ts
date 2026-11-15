import { ApiFehler } from '../fehler';
import { mitBetrieb, systemAbfrage, type Kontext } from '../db';
import { entschluessele, hinweis, verschluessele } from '../geheimnis';
import { berlinTag } from '../../zeit';
import { lexwareClient, LexwareFehler, type LexwareClient } from './client';

/**
 * Verbindung zu Lexware je Betrieb (Einstellungen → „Lexware verbinden“; Rechte prüft der Aufrufer).
 * Den API-Schlüssel legt der Lexware-Kontoadministrator unter „Erweiterungen → Public API“ an (nur Tarif XL, höchstens
 * 24 Monate gültig). Er wird verschlüsselt gespeichert, nie wieder angezeigt (nur „…abcd“) und nur hier entschlüsselt.
 */

export type LexwareKonfig = {
	verbunden: boolean;
	status: 'nicht_verbunden' | 'verbunden' | 'schluessel_ungueltig' | 'fehler';
	schluesselGesetzt: boolean;
	schluesselHinweis: string | null;
	gueltigBis: string | null;
	organisationId: string | null;
	firmenname: string | null;
	steuerart: string | null;
	kleinunternehmer: boolean | null;
	geprueftAm: string | null;
	letzterFehler: string | null;
	kundenAnlegen: boolean;
	letzterAbgleich: string | null;
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const tag = (d: unknown) => (d ? (d instanceof Date ? berlinTag(d) : String(d).slice(0, 10)) : null);

export async function ladeLexwareKonfig(k: Kontext): Promise<LexwareKonfig> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		select schluessel_hinweis, gueltig_bis, status, organisation_id, firmenname, steuerart, kleinunternehmer, geprueft_am,
			letzter_fehler, kunden_anlegen, letzter_abgleich
		from app.lexware_konfig where betrieb_id = ${k.betriebId}`);
	return {
		verbunden: z?.status === 'verbunden',
		status: z?.status ?? 'nicht_verbunden',
		schluesselGesetzt: !!z?.schluessel_hinweis,
		schluesselHinweis: z?.schluessel_hinweis ?? null,
		gueltigBis: tag(z?.gueltig_bis),
		organisationId: z?.organisation_id ?? null,
		firmenname: z?.firmenname ?? null,
		steuerart: z?.steuerart ?? null,
		kleinunternehmer: z?.kleinunternehmer ?? null,
		geprueftAm: iso(z?.geprueft_am),
		letzterFehler: z?.letzter_fehler ?? null,
		kundenAnlegen: z?.kunden_anlegen ?? false,
		letzterAbgleich: iso(z?.letzter_abgleich)
	};
}

/** Speichert einen neuen Schlüssel (verschlüsselt) und prüft gleich die Verbindung. */
export async function speichereLexwareSchluessel(k: Kontext, schluessel: unknown, gueltigBis?: unknown): Promise<LexwareKonfig> {
	if (typeof schluessel !== 'string' || !/^[A-Za-z0-9._~+/=-]{20,500}$/.test(schluessel.trim()))
		throw new ApiFehler(400, 'Bitte den API-Schlüssel aus Lexware (Erweiterungen → Public API) vollständig einfügen.');
	const s = schluessel.trim();
	let bis: string | null = null;
	if (gueltigBis !== undefined && gueltigBis !== null && gueltigBis !== '') {
		if (typeof gueltigBis !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(gueltigBis)) throw new ApiFehler(400, 'Gültig bis: Bitte ein Datum wählen.');
		bis = gueltigBis;
	} else {
		const d = new Date();
		d.setMonth(d.getMonth() + 24);
		bis = berlinTag(d);
	}
	const chiffrat = verschluessele(s, 'lexware', k.betriebId);
	await mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.lexware_konfig where betrieb_id = ${k.betriebId}`;
		if (da)
			await tx`update app.lexware_konfig set schluessel = ${chiffrat}, schluessel_hinweis = ${hinweis(s)}, gueltig_bis = ${bis}, status = 'nicht_verbunden',
				letzter_fehler = null, eingerichtet_von = ${k.benutzerId} where betrieb_id = ${k.betriebId}`;
		else
			await tx`insert into app.lexware_konfig (betrieb_id, schluessel, schluessel_hinweis, gueltig_bis, status, eingerichtet_von)
				values (${k.betriebId}, ${chiffrat}, ${hinweis(s)}, ${bis}, 'nicht_verbunden', ${k.benutzerId})`;
	});
	await pruefeVerbindung(k);
	return ladeLexwareKonfig(k);
}

const offeneProtokolle = new Set<Promise<unknown>>();
/** Wartet, bis alle Protokolleinträge geschrieben sind (Tests). */
export async function protokollFertig(): Promise<void> {
	await Promise.all([...offeneProtokolle]);
}

/** Client mit dem entschlüsselten Schlüssel des Betriebs; schreibt jede Anfrage ins Lexware-Protokoll. */
export async function holeClient(k: Kontext, o: { auftragId?: string; abstandMs?: number; zeitlimitMs?: number } = {}): Promise<LexwareClient> {
	const [z] = await systemAbfrage((sql) => sql`select app.lexware_schluessel(${k.betriebId}::uuid) as s`);
	if (!z?.s) throw new ApiFehler(409, 'Lexware ist noch nicht verbunden (Einstellungen → Lexware verbinden).');
	const schluessel = entschluessele(z.s, 'lexware', k.betriebId);
	return lexwareClient({
		schluessel,
		ratenKey: k.betriebId,
		abstandMs: o.abstandMs,
		zeitlimitMs: o.zeitlimitMs,
		protokoll: (e) => {
			const p = mitBetrieb(k, (tx) => tx`
				insert into app.lexware_protokoll (betrieb_id, methode, pfad, status, dauer_ms, fehler, auftrag_id)
				values (${k.betriebId}, ${e.methode}, ${e.pfad}, ${e.status}, ${e.dauerMs}, ${e.fehler}, ${o.auftragId ?? null})`).catch((err) =>
				console.error('Lexware-Protokoll:', (err as Error).message)
			);
			offeneProtokolle.add(p);
			void p.finally(() => offeneProtokolle.delete(p));
		}
	});
}

type Profil = { organizationId?: string; companyName?: string; taxType?: string; smallBusiness?: boolean };

/** „Verbindung prüfen“: GET /v1/profile – speichert Organisation, Firmenname, Steuerart und Kleinunternehmer. */
export async function pruefeVerbindung(k: Kontext, client?: LexwareClient): Promise<LexwareKonfig> {
	let p: Profil;
	try {
		p = await (client ?? (await holeClient(k))).get<Profil>('/v1/profile');
	} catch (e) {
		if (!(e instanceof LexwareFehler)) throw e;
		const status = e.art === 'schluessel' ? 'schluessel_ungueltig' : 'fehler';
		await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set status = ${status}, letzter_fehler = ${e.message.slice(0, 1000)}, geprueft_am = now() where betrieb_id = ${k.betriebId}`);
		return ladeLexwareKonfig(k);
	}
	const org = typeof p.organizationId === 'string' && /^[0-9a-f-]{36}$/i.test(p.organizationId) ? p.organizationId : null;
	try {
		await mitBetrieb(k, (tx) => tx`
			update app.lexware_konfig set status = 'verbunden', letzter_fehler = null, geprueft_am = now(), organisation_id = ${org},
				firmenname = ${typeof p.companyName === 'string' ? p.companyName.slice(0, 300) : null},
				steuerart = ${typeof p.taxType === 'string' ? p.taxType.slice(0, 40) : null},
				kleinunternehmer = ${typeof p.smallBusiness === 'boolean' ? p.smallBusiness : null}
			where betrieb_id = ${k.betriebId}`);
	} catch (e) {
		if ((e as { code?: string }).code !== '23505') throw e;
		await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set status = 'fehler', letzter_fehler = 'Dieses Lexware-Konto ist schon mit einem anderen Betrieb verbunden.', geprueft_am = now() where betrieb_id = ${k.betriebId}`);
	}
	return ladeLexwareKonfig(k);
}

export async function setzeKundenAnlegen(k: Kontext, an: boolean): Promise<void> {
	await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set kunden_anlegen = ${an} where betrieb_id = ${k.betriebId}`);
}

/** Verbindung trennen: Rückmeldungen in Lexware abbestellen (so weit möglich), Schlüssel und offene Aufträge löschen. */
export async function trenneLexware(k: Kontext): Promise<void> {
	try {
		const c = await holeClient(k);
		const abos = await mitBetrieb(k, (tx) => tx`select lexware_id from app.lexware_abos where betrieb_id = ${k.betriebId} and lexware_id is not null`);
		for (const a of abos) await c.del(`/v1/event-subscriptions/${a.lexware_id}`).catch(() => undefined);
	} catch {
		// Schlüssel schon ungültig/fehlt: Lexware entfernt die Abos beim Widerruf selbst
	}
	await mitBetrieb(k, async (tx) => {
		await tx`update app.lexware_auftraege set status = 'abgebrochen', letzter_fehler = 'Verbindung getrennt', erledigt_am = now()
			where betrieb_id = ${k.betriebId} and status in ('wartet', 'ungewiss', 'pruefen', 'laeuft')`;
		await tx`delete from app.lexware_abos where betrieb_id = ${k.betriebId}`;
		await tx`delete from app.lexware_konfig where betrieb_id = ${k.betriebId}`;
	});
}
