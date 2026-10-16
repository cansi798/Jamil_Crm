import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { istRecht, istVorlage, VORLAGEN, type Vorlage } from './rechte';

/**
 * Fachlogik für Rollen, gemeinsam genutzt von der API (`/api/rollen`) und den Seiten unter `/einstellungen/rollen`.
 * Alles läuft in `mitBetrieb` (RLS: nur der eigene Betrieb); Fehler sind `ApiFehler` mit deutscher Meldung.
 */

export type Rolle = { id: string; name: string; rechte: string[]; vorlage: string | null };
export type RolleMitAnzahl = Rolle & { benutzer: number };

export const SCHUTZ_MELDUNG = 'Mindestens ein Benutzer muss die Einstellungen verwalten können.';
const NAME_MAX = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pruefeName(wert: unknown): string {
	const name = typeof wert === 'string' ? wert.trim() : '';
	if (name === '' || name.length > NAME_MAX) {
		throw new ApiFehler(400, `Der Name der Rolle fehlt oder ist zu lang (höchstens ${NAME_MAX} Zeichen).`);
	}
	return name;
}

/** Prüft eine Liste von Recht-Schlüsseln (nur bekannte, ohne Duplikate). */
export function pruefeRechte(wert: unknown): string[] {
	if (!Array.isArray(wert)) throw new ApiFehler(400, 'Die Rechte müssen als Liste angegeben werden.');
	const unbekannt = wert.filter((r) => !istRecht(r));
	if (unbekannt.length > 0) {
		throw new ApiFehler(400, `Unbekannte Rechte: ${unbekannt.map((r) => String(r).slice(0, 60)).join(', ')}`);
	}
	return [...new Set(wert as string[])];
}

const pruefeId = (id: string): string => {
	if (!UUID.test(id)) throw new ApiFehler(404, 'Rolle nicht gefunden.');
	return id;
};

/**
 * Serialisiert alle Änderungen, die die Schutzregel berühren können (Rechte von Rollen, Rollenzuweisung und
 * Aktivstatus von Benutzern), je Betrieb. Gilt bis zum Ende der Transaktion. Zuerst aufrufen, dann ändern, dann
 * `pruefeEinstellungenVerwalter` – so sehen gleichzeitige Anfragen die Änderung der anderen.
 */
export async function sperreEinstellungenPruefung(tx: TransactionSql, betriebId: string): Promise<void> {
	await tx`select pg_advisory_xact_lock(hashtext(${'einstellungen-verwalter:' + betriebId}))`;
}

/** Schutzregel: Nach der Änderung muss mindestens ein aktiver Benutzer eine Rolle mit 'einstellungen' haben, sonst 409. */
export async function pruefeEinstellungenVerwalter(tx: TransactionSql): Promise<void> {
	const [z] = await tx`
		select exists (
			select 1 from app.benutzer b
			join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
			where b.aktiv and 'einstellungen' = any (r.rechte)
		) as vorhanden`;
	if (!z.vorhanden) throw new ApiFehler(409, SCHUTZ_MELDUNG);
}

export function listeRollen(k: Kontext): Promise<RolleMitAnzahl[]> {
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			select r.id, r.name, r.rechte, r.vorlage,
				(select count(*)::int from app.benutzer b where b.rolle_id = r.id) as benutzer
			from app.rollen r
			order by r.name, r.id`;
		return zeilen as unknown as RolleMitAnzahl[];
	});
}

export function holeRolle(k: Kontext, id: string): Promise<Rolle> {
	return mitBetrieb(k, async (tx) => {
		const [r] = await tx`select id, name, rechte, vorlage from app.rollen where id = ${pruefeId(id)}`;
		if (!r) throw new ApiFehler(404, 'Rolle nicht gefunden.');
		return r as unknown as Rolle;
	});
}

export type NeueRolle = { name?: unknown; vorlage?: unknown; rechte?: unknown };

/** Legt eine Rolle an: Rechte aus `rechte`, sonst aus der Vorlage, sonst leer. */
export function legeRolleAn(k: Kontext, eingabe: NeueRolle): Promise<Rolle> {
	const name = pruefeName(eingabe.name);
	let vorlage: Vorlage | null = null;
	if (eingabe.vorlage !== undefined && eingabe.vorlage !== null && eingabe.vorlage !== '') {
		if (!istVorlage(eingabe.vorlage)) throw new ApiFehler(400, 'Unbekannte Vorlage.');
		vorlage = eingabe.vorlage;
	}
	const rechte =
		eingabe.rechte !== undefined ? pruefeRechte(eingabe.rechte) : vorlage ? [...VORLAGEN[vorlage]] : [];
	return mitBetrieb(k, async (tx) => {
		const [r] = await tx`
			insert into app.rollen (betrieb_id, name, rechte, vorlage)
			values (${k.betriebId}, ${name}, ${rechte}::text[], ${vorlage})
			returning id, name, rechte, vorlage`;
		return r as unknown as Rolle;
	});
}

export type RollenAenderung = { name?: unknown; rechte?: unknown };

/**
 * Ändert Name und/oder Rechte. Verliert die Rolle 'einstellungen', greift die Schutzregel (409, die ganze Änderung
 * wird zurückgenommen). Bekommt sie 'einstellungen' neu, enden die Sitzungen ihrer Benutzer, damit die
 * Zwei-Faktor-Pflicht sofort gilt.
 */
export function aendereRolle(k: Kontext, id: string, eingabe: RollenAenderung): Promise<Rolle> {
	pruefeId(id);
	if (eingabe.name === undefined && eingabe.rechte === undefined) {
		throw new ApiFehler(400, 'Nichts zu ändern: Name oder Rechte angeben.');
	}
	const name = eingabe.name !== undefined ? pruefeName(eingabe.name) : undefined;
	const rechte = eingabe.rechte !== undefined ? pruefeRechte(eingabe.rechte) : undefined;
	return mitBetrieb(k, async (tx) => {
		await sperreEinstellungenPruefung(tx, k.betriebId);
		const [alt] = await tx`select id, name, rechte, vorlage from app.rollen where id = ${id} for update`;
		if (!alt) throw new ApiFehler(404, 'Rolle nicht gefunden.');
		const neueRechte = rechte ?? (alt.rechte as string[]);
		const [neu] = await tx`
			update app.rollen
			set name = ${name ?? alt.name}, rechte = ${neueRechte}::text[]
			where id = ${id}
			returning id, name, rechte, vorlage`;
		const hatteEinstellungen = (alt.rechte as string[]).includes('einstellungen');
		const hatEinstellungen = neueRechte.includes('einstellungen');
		if (hatteEinstellungen && !hatEinstellungen) await pruefeEinstellungenVerwalter(tx);
		if (!hatteEinstellungen && hatEinstellungen) {
			await tx`select app.sitzungen_beenden_fuer_rolle(${id}::uuid)`;
		}
		return neu as unknown as Rolle;
	});
}

/** Löscht eine Rolle, die kein Benutzer (auch kein inaktiver) mehr hat. */
export function loescheRolle(k: Kontext, id: string): Promise<void> {
	pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		await sperreEinstellungenPruefung(tx, k.betriebId);
		const [alt] = await tx`select id, name, rechte, vorlage from app.rollen where id = ${id} for update`;
		if (!alt) throw new ApiFehler(404, 'Rolle nicht gefunden.');
		const [{ n }] = await tx`select count(*)::int as n from app.benutzer where rolle_id = ${id}`;
		if (n > 0) {
			throw new ApiFehler(409, 'Die Rolle wird noch von Benutzern verwendet. Weisen Sie diesen zuerst eine andere Rolle zu.');
		}
		try {
			await tx`delete from app.rollen where id = ${id}`;
		} catch (e) {
			// Ein Benutzer wurde gleichzeitig zugewiesen: Fremdschlüssel verhindert das Löschen.
			if ((e as { code?: string }).code === '23503') {
				throw new ApiFehler(409, 'Die Rolle wird noch von Benutzern verwendet. Weisen Sie diesen zuerst eine andere Rolle zu.');
			}
			throw e;
		}
		if ((alt.rechte as string[]).includes('einstellungen')) await pruefeEinstellungenVerwalter(tx);
	});
}
