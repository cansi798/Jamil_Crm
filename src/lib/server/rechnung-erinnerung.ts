import type { TransactionSql } from 'postgres';
import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { berlinTag, werktagePlus } from '../zeit';
import { STANDARD_EINSTELLUNG, ZUWEISUNGEN, type ErinnerungEinstellung } from '../rechnung-erinnerung';

/**
 * Erinnerung „Rechnung erstellen“ beim Abschluss eines Auftrags (Jamil, Talk „CRM System“ msg 6525/6527, 20.11.2026:
 * „Mach nur Erinnerung, aber noch keine Rechnung fertig“). Wechselt ein Auftrag auf „Abgenommen“, legt das CRM NUR eine
 * Aufgabe (+ Glocke) an – standardmäßig fürs Büro bzw. den Chef, der Betrieb kann es selbst einstellen (msg 6530) –, fällig in zwei Werktagen, mit Link zum Auftrag. Es entsteht
 * KEIN Rechnungsentwurf in Lexware; die Rechnung erstellt das Büro selbst über „Rechnung erstellen“ im Auftrag.
 *
 * Doppelt wird nichts: Gibt es zum Auftrag schon diese Aufgabe (offen oder erledigt), passiert nichts – auch nicht,
 * wenn der Auftrag zurück auf „In Arbeit“ und wieder auf „Abgenommen“ geht. Läuft innerhalb der Transaktion des
 * Statuswechsels, die die Auftragszeile sperrt (`for update`) – zwei gleichzeitige Wechsel legen also keine zwei an.
 */
export const RECHNUNG_ERINNERUNG_WERKTAGE = 2;

export function rechnungErinnerungTitel(nummer: string): string {
	return `Rechnung für Auftrag ${nummer} erstellen`;
}

export { ZUWEISUNGEN, ZUWEISUNG_NAMEN, STANDARD_EINSTELLUNG, type Zuweisung, type ErinnerungEinstellung } from '../rechnung-erinnerung';

async function ladeIn(tx: TransactionSql, k: Kontext): Promise<ErinnerungEinstellung> {
	const [e] = await tx`select zuweisung, benutzer_id, rolle_id from app.rechnung_erinnerung_einstellung where betrieb_id = ${k.betriebId}`;
	return e ? { zuweisung: e.zuweisung, benutzerId: e.benutzer_id ?? null, rolleId: e.rolle_id ?? null } : { ...STANDARD_EINSTELLUNG };
}

export async function ladeErinnerungEinstellung(k: Kontext): Promise<ErinnerungEinstellung> {
	return mitBetrieb(k, (tx) => ladeIn(tx, k));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Speichert die Zuweisung (400 bei fehlender/fremder Person bzw. Rolle). */
export async function speichereErinnerungEinstellung(
	k: Kontext,
	e: { zuweisung?: unknown; benutzerId?: unknown; rolleId?: unknown }
): Promise<ErinnerungEinstellung> {
	const z = e.zuweisung;
	if (typeof z !== 'string' || !(ZUWEISUNGEN as readonly string[]).includes(z)) throw new ApiFehler(400, 'Bitte eine Zuweisung wählen.');
	const id = (w: unknown) => (typeof w === 'string' && UUID.test(w.trim()) ? w.trim() : null);
	const benutzerId = z === 'person' ? id(e.benutzerId) : null;
	const rolleId = z === 'rolle' ? id(e.rolleId) : null;
	if (z === 'person' && !benutzerId) throw new ApiFehler(400, 'Bitte eine Person auswählen.');
	if (z === 'rolle' && !rolleId) throw new ApiFehler(400, 'Bitte eine Rolle auswählen.');
	return mitBetrieb(k, async (tx) => {
		if (benutzerId) {
			const [b] = await tx`select 1 from app.benutzer where id = ${benutzerId} and betrieb_id = ${k.betriebId} and aktiv`;
			if (!b) throw new ApiFehler(400, 'Diese Person gibt es nicht (mehr).');
		}
		if (rolleId) {
			const [r] = await tx`select 1 from app.rollen where id = ${rolleId} and betrieb_id = ${k.betriebId}`;
			if (!r) throw new ApiFehler(400, 'Diese Rolle gibt es nicht (mehr).');
		}
		await tx`
			insert into app.rechnung_erinnerung_einstellung (betrieb_id, zuweisung, benutzer_id, rolle_id)
			values (${k.betriebId}, ${z}, ${benutzerId}, ${rolleId})
			on conflict (betrieb_id) do update set zuweisung = excluded.zuweisung, benutzer_id = excluded.benutzer_id, rolle_id = excluded.rolle_id`;
		return ladeIn(tx, k);
	});
}

/**
 * Empfänger der Erinnerung: die eingestellte Person bzw. die erste aktive Person der eingestellten Rolle; sonst (oder wenn
 * die nicht mehr aktiv ist) der Standard – Büro zuerst (Rollenvorlage bzw. Name „Büro…“), dann wer Rechnungen erstellen
 * darf (Chef vorn), sonst niemand.
 */
export async function empfaenger(tx: TransactionSql, k: Kontext): Promise<string | null> {
	const e = await ladeIn(tx, k);
	if (e.zuweisung === 'person' && e.benutzerId) {
		const [b] = await tx`select id from app.benutzer where id = ${e.benutzerId} and betrieb_id = ${k.betriebId} and aktiv`;
		if (b) return b.id;
	}
	if (e.zuweisung === 'rolle' && e.rolleId) {
		const [b] = await tx`
			select id from app.benutzer where rolle_id = ${e.rolleId} and betrieb_id = ${k.betriebId} and aktiv
			order by public.unaccent(lower(name)), id limit 1`;
		if (b) return b.id;
	}
	const [b] = await tx`
		select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.betrieb_id = ${k.betriebId} and b.aktiv and 'preise.sehen' = any (r.rechte)
			and ('rechnungen.erstellen' = any (r.rechte) or 'angebote.bearbeiten' = any (r.rechte) or 'einstellungen' = any (r.rechte))
		order by (coalesce(r.vorlage, '') = 'buero' or lower(r.name) like 'büro%' or lower(r.name) like 'buero%') desc,
			('rechnungen.erstellen' = any (r.rechte)) desc, ('einstellungen' = any (r.rechte)) desc, b.name, b.id
		limit 1`;
	return b?.id ?? null;
}

/** Legt die Erinnerung an (falls noch keine da ist). Liefert die Aufgaben-ID oder `null`, wenn es sie schon gab. */
export async function erinnereAnRechnung(tx: TransactionSql, k: Kontext, auftragId: string, heute = berlinTag(new Date())): Promise<string | null> {
	const [a] = await tx`select nummer, titel from app.auftraege where id = ${auftragId} and betrieb_id = ${k.betriebId}`;
	if (!a) return null;
	const titel = rechnungErinnerungTitel(a.nummer).slice(0, 200);
	const [da] = await tx`select id from app.todos where betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId} and titel = ${titel} limit 1`;
	if (da) return null;
	const wer = await empfaenger(tx, k);
	const faellig = werktagePlus(heute, RECHNUNG_ERINNERUNG_WERKTAGE);
	const text = `Auftrag ${a.nummer} (${a.titel}) ist abgenommen. Bitte die Rechnung erstellen – im Auftrag über „Rechnung erstellen“. Es wurde noch keine Rechnung angelegt.`.slice(0, 500);
	const link = `/auftraege/${auftragId}`;
	const [t] = await tx`
		insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig)
		values (${k.betriebId}, ${auftragId}, ${titel}, ${text}, ${wer}, ${faellig}) returning id`;
	if (wer) {
		const [er] = await tx`
			insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
			values (${k.betriebId}, ${wer}, ${t.id}, now(), ${titel.slice(0, 300)}, ${text}, ${link}) returning id`;
		await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${er.id} and betrieb_id = ${k.betriebId}`;
	}
	return t.id as string;
}
