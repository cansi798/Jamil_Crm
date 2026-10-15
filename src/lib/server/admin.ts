import { mitAdmin, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { pruefeEmail } from './benutzer';
import { VORLAGEN, VORLAGEN_NAMEN, type Vorlage } from './rechte';
import { istAboStatus } from '../abo';
import { sortiereTarifSchluessel } from '../tarife';

/**
 * Plattform-Verwaltung (Admin-Bereich `/admin`, `/api/admin/*`). Alles läuft als `crm_admin` über `mitAdmin` und
 * ausschließlich über die SECURITY-DEFINER-Funktionen aus Migration 008 – die Rolle hat keine Tabellenrechte, sieht
 * also nie Kundendaten. Die Datenbank prüft selbst noch einmal, dass `app.admin_id` ein angemeldeter Plattform-Admin
 * (mit zweitem Faktor) ist; die Prüfung hier (`pruefeAdmin`) ist die erste Verteidigungslinie.
 *
 * Für alle, die keine Plattform-Admins sind (auch Gäste), gibt es den Bereich nicht: 404 statt 401/403, damit seine
 * Existenz nicht verraten wird.
 */

export const MELDUNG_NICHT_GEFUNDEN = 'Nicht gefunden.';

export type BetriebUebersicht = {
	id: string;
	name: string;
	/** Schlüssel des Tarifs, z. B. `profi` */
	tarif: string;
	aboStatus: string;
	/** `YYYY-MM-DD` oder `null` */
	aboEnde: string | null;
	benutzerAnzahl: number;
	letzteAktivitaet: string | null;
};

export type TarifAuswahl = { schluessel: string; name: string };

export type AdminProtokollEintrag = {
	id: string;
	zeit: string;
	adminName: string | null;
	aktion: string;
	details: Record<string, any>;
};

export type NeuerBetrieb = { name?: unknown; tarif?: unknown; chefEmail?: unknown; chefName?: unknown };
export type BetriebAenderung = { tarif?: unknown; aboStatus?: unknown; aboEnde?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Wirft 404, wenn der Nutzer kein Plattform-Admin ist (Gast, Betriebsnutzer). Liefert den Admin. */
export function pruefeAdmin(locals: { nutzer: Nutzer | null }): Nutzer {
	const n = locals.nutzer;
	if (!n || !n.istAdmin || n.betriebId !== null) throw new ApiFehler(404, MELDUNG_NICHT_GEFUNDEN);
	return n;
}

/** Fehlerschlüssel der Admin-Funktionen (Meldung der SQL-Ausnahme) → Antwort. */
const SQL_FEHLER: Record<string, [number, string]> = {
	kein_plattform_admin: [404, MELDUNG_NICHT_GEFUNDEN],
	name_ungueltig: [400, 'Bitte einen Namen für den Betrieb angeben (höchstens 200 Zeichen).'],
	chef_name_ungueltig: [400, 'Bitte den Namen des Chefs angeben (höchstens 100 Zeichen).'],
	email_ungueltig: [400, 'Bitte eine gültige E-Mail-Adresse angeben.'],
	email_vergeben: [409, 'Diese E-Mail ist bereits registriert.'],
	tarif_unbekannt: [400, 'Unbekannter Tarif.'],
	status_ungueltig: [400, 'Unbekannter Abo-Status.'],
	abo_ende_widerspruch: [400, 'Ungültiges Abo-Ende.'],
	betrieb_unbekannt: [404, 'Betrieb nicht gefunden.']
};
const SQL_CODES = new Set(['42501', '22023', '23505', 'P0002']);

/** `mitAdmin` mit Übersetzung der bekannten Datenbankfehler in `ApiFehler`. */
async function alsAdmin<T>(adminId: string, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
	try {
		return await mitAdmin(adminId, fn);
	} catch (e) {
		const f = e as { code?: string; message?: string };
		const bekannt = f.code && SQL_CODES.has(f.code) && f.message ? SQL_FEHLER[f.message] : undefined;
		if (bekannt) throw new ApiFehler(bekannt[0], bekannt[1]);
		throw e;
	}
}

type BetriebZeile = {
	id: string;
	name: string;
	tarif: string;
	abo_status: string;
	abo_ende: string | null;
	benutzer_anzahl: number;
	letzte_aktivitaet: Date | null;
};

const alsUebersicht = (z: BetriebZeile): BetriebUebersicht => ({
	id: z.id,
	name: z.name,
	tarif: z.tarif,
	aboStatus: z.abo_status,
	aboEnde: z.abo_ende,
	benutzerAnzahl: z.benutzer_anzahl,
	letzteAktivitaet: z.letzte_aktivitaet ? new Date(z.letzte_aktivitaet).toISOString() : null
});

/** Alle Betriebe mit Verwaltungsdaten (nach Name). */
export function listeBetriebe(adminId: string): Promise<BetriebUebersicht[]> {
	return alsAdmin(adminId, async (tx) => {
		const z = await tx<BetriebZeile[]>`
			select id, name, tarif, abo_status, abo_ende::text as abo_ende, benutzer_anzahl, letzte_aktivitaet
			from app.admin_betriebe()`;
		return z.map(alsUebersicht);
	});
}

/** Ein Betrieb; 404, wenn es ihn nicht gibt (oder die ID keine UUID ist). */
export async function holeBetrieb(adminId: string, id: string): Promise<BetriebUebersicht> {
	if (!UUID.test(id)) throw new ApiFehler(404, 'Betrieb nicht gefunden.');
	const z = await alsAdmin(adminId, (tx) => tx<BetriebZeile[]>`
		select id, name, tarif, abo_status, abo_ende::text as abo_ende, benutzer_anzahl, letzte_aktivitaet
		from app.admin_betrieb(${id}::uuid)`);
	if (!z[0]) throw new ApiFehler(404, 'Betrieb nicht gefunden.');
	return alsUebersicht(z[0]);
}

/** Tarife für Auswahllisten, nach Preisstufe (basis, profi, premium, test zuletzt). */
export async function tarifeFuerAdmin(adminId: string): Promise<TarifAuswahl[]> {
	const z = await alsAdmin(adminId, (tx) => tx<TarifAuswahl[]>`select schluessel, name from app.admin_tarife()`);
	return sortiereTarifSchluessel(z.map((t) => t.schluessel)).map((s) => {
		const t = z.find((x) => x.schluessel === s)!;
		return { schluessel: t.schluessel, name: t.name };
	});
}

const text = (wert: unknown) => (typeof wert === 'string' ? wert : '');

/**
 * Legt einen Betrieb an (Status „Test“) – mit den drei Rollen aus den Vorlagen (`VORLAGEN` ist die einzige Quelle
 * und wird an die Datenbank übergeben) und einer Einladung für den Chef. Liefert nur das Einladungs-Token; daraus
 * baut der Aufrufer den Link, der genau einmal angezeigt wird. Es wird keine E-Mail verschickt.
 */
export async function legeBetriebAn(adminId: string, eingabe: NeuerBetrieb): Promise<string> {
	const name = text(eingabe.name).trim();
	const chefName = text(eingabe.chefName).trim();
	if (name === '' || name.length > 200) throw new ApiFehler(400, SQL_FEHLER.name_ungueltig[1]);
	if (chefName === '' || chefName.length > 100) throw new ApiFehler(400, SQL_FEHLER.chef_name_ungueltig[1]);
	const email = pruefeEmail(eingabe.chefEmail);
	const tarif = text(eingabe.tarif);
	if (tarif === '') throw new ApiFehler(400, SQL_FEHLER.tarif_unbekannt[1]);
	const vorlagen = (Object.keys(VORLAGEN) as Vorlage[]).map((v) => ({
		vorlage: v,
		name: VORLAGEN_NAMEN[v],
		rechte: [...VORLAGEN[v]]
	}));
	return alsAdmin(adminId, async (tx) => {
		const [z] = await tx`
			select app.admin_betrieb_anlegen(${name}, ${tarif}, ${email}, ${chefName}, ${tx.json(vorlagen)}) as token`;
		return z.token as string;
	});
}

/** Prüft `YYYY-MM-DD` auf ein echtes Kalenderdatum. */
function pruefeDatum(wert: string): string {
	const m = DATUM.exec(wert);
	const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
	if (!m || !d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
		throw new ApiFehler(400, 'Bitte ein gültiges Datum angeben (JJJJ-MM-TT).');
	}
	return wert;
}

/**
 * Ändert Tarif (Schlüssel), Abo-Status und/oder Abo-Ende. Fehlende Felder bleiben unverändert; `aboEnde` `null`
 * oder `''` entfernt das Abo-Ende. Sperren beendet sofort alle Sitzungen des Betriebs.
 */
export async function aendereBetrieb(adminId: string, id: string, eingabe: BetriebAenderung): Promise<void> {
	if (!UUID.test(id)) throw new ApiFehler(404, 'Betrieb nicht gefunden.');
	const { tarif, aboStatus, aboEnde } = eingabe;
	if (tarif === undefined && aboStatus === undefined && aboEnde === undefined) {
		throw new ApiFehler(400, 'Nichts zu ändern: Tarif, Abo-Status oder Abo-Ende angeben.');
	}
	if (tarif !== undefined && (typeof tarif !== 'string' || tarif === '')) {
		throw new ApiFehler(400, SQL_FEHLER.tarif_unbekannt[1]);
	}
	if (aboStatus !== undefined && !istAboStatus(aboStatus)) throw new ApiFehler(400, SQL_FEHLER.status_ungueltig[1]);
	const leeren = aboEnde === null || aboEnde === '';
	let ende: string | null = null;
	if (aboEnde !== undefined && !leeren) {
		if (typeof aboEnde !== 'string') throw new ApiFehler(400, 'Bitte ein gültiges Datum angeben (JJJJ-MM-TT).');
		ende = pruefeDatum(aboEnde);
	}
	await alsAdmin(adminId, (tx) => tx`
		select app.admin_betrieb_aendern(
			${id}::uuid, ${tarif ?? null}::text, ${aboStatus ?? null}::text, ${ende}::date, ${leeren}
		)`);
}

/** Änderungsverlauf eines Betriebs aus dem Admin-Protokoll (neueste zuerst, höchstens 50). */
export async function adminProtokoll(adminId: string, betriebId: string): Promise<AdminProtokollEintrag[]> {
	if (!UUID.test(betriebId)) throw new ApiFehler(404, 'Betrieb nicht gefunden.');
	const z = await alsAdmin(adminId, (tx) => tx`
		select id::text as id, zeit, admin_name, aktion, details from app.admin_protokoll_lesen(${betriebId}::uuid)`);
	return z.map((e) => ({
		id: e.id,
		zeit: new Date(e.zeit).toISOString(),
		adminName: e.admin_name,
		aktion: e.aktion,
		details: e.details
	}));
}
