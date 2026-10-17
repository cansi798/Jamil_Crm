import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { pruefeModul } from './tarif';

/**
 * Baustellen-Protokolle (Abnahme, Regiebericht, Aufmaß, Mängelliste) zu Aufträgen.
 * Modul: `protokolle`. Unterschrift als PNG (max 500 KB), PDF wird nach Erzeugung gespeichert.
 */

export type ProtokollTyp = 'abnahme' | 'regiebericht' | 'aufmass' | 'maengelliste';

export type Protokoll = {
	id: string;
	auftragId: string;
	typ: ProtokollTyp;
	inhalt: Record<string, unknown>;
	unterschriftVorhanden: boolean;
	pdfVorhanden: boolean;
	angelegt: string;
	geaendert: string;
	vonBenutzerId: string | null;
};

const UNTERSCHRIFT_MAX_BYTES = 512 * 1000; // 500 KB

const PROTOKOLL_TYPEN = new Set<ProtokollTyp>(['abnahme', 'regiebericht', 'aufmass', 'maengelliste']);

/**
 * Legt ein neues Protokoll an. Prüft Modul `protokolle`.
 */
export async function legeProtokollAn(
	k: Kontext,
	auftragId: string,
	typ: ProtokollTyp,
	inhalt?: Record<string, unknown>,
	vonBenutzerId?: string
): Promise<Protokoll> {
	if (!PROTOKOLL_TYPEN.has(typ)) {
		throw new ApiFehler(400, `Unbekannter Protokoll-Typ: ${typ}`);
	}
	return mitBetrieb(k, async (tx) => {
		// Modul-Prüfung über den Tarif des Betriebs
		await pruefeModul({ nutzer: { id: k.benutzerId, betriebId: k.betriebId, istAdmin: false, rechte: [], betriebStatus: 'aktiv' } }, 'protokolle');
		const [z] = await tx`
			insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ, inhalt, von_benutzer_id)
			values (${k.betriebId}, ${auftragId}, ${typ}, ${JSON.stringify(inhalt ?? {})}, ${vonBenutzerId ?? null})
			returning id, auftrag_id as "auftragId", typ, inhalt,
				(unterschrift is not null) as "unterschriftVorhanden",
				(pdf is not null) as "pdfVorhanden",
				angelegt, geaendert, von_benutzer_id as "vonBenutzerId"`;
		return { ...z, inhalt: typeof z.inhalt === 'string' ? JSON.parse(z.inhalt) : z.inhalt } as Protokoll;
	});
}

/**
 * Aktualisiert den Inhalt eines Protokolls (nur wenn noch keine Unterschrift vorhanden).
 */
export async function aktualisiereProtokoll(
	k: Kontext,
	protokollId: string,
	inhalt: Record<string, unknown>
): Promise<Protokoll> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			update app.baustellen_protokolle set inhalt = ${JSON.stringify(inhalt)}
			where id = ${protokollId} and unterschrift is null
			returning id, auftrag_id as "auftragId", typ, inhalt,
				(unterschrift is not null) as "unterschriftVorhanden",
				(pdf is not null) as "pdfVorhanden",
				angelegt, geaendert, von_benutzer_id as "vonBenutzerId"`;
		if (!z) throw new ApiFehler(404, 'Protokoll nicht gefunden oder bereits unterschrieben');
		return { ...z, inhalt: typeof z.inhalt === 'string' ? JSON.parse(z.inhalt) : z.inhalt } as Protokoll;
	});
}

/**
 * Speichert eine Kundenunterschrift (PNG, max 500 KB).
 */
export async function speichereUnterschrift(
	k: Kontext,
	protokollId: string,
	unterschrift: Buffer | Uint8Array
): Promise<void> {
	if (unterschrift.length > UNTERSCHRIFT_MAX_BYTES) {
		throw new ApiFehler(413, 'Die Unterschrift ist zu groß (max. 500 KB)');
	}
	await mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			update app.baustellen_protokolle set unterschrift = ${unterschrift}
			where id = ${protokollId}
			returning id`;
		if (!z) throw new ApiFehler(404, 'Protokoll nicht gefunden');
	});
}

/**
 * Liest ein Protokoll (ohne bytea-Felder). Gibt null zurück, wenn nicht gefunden.
 */
export async function liesProtokoll(k: Kontext, protokollId: string): Promise<Protokoll | null> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select id, auftrag_id as "auftragId", typ, inhalt,
				(unterschrift is not null) as "unterschriftVorhanden",
				(pdf is not null) as "pdfVorhanden",
				angelegt, geaendert, von_benutzer_id as "vonBenutzerId"
			from app.baustellen_protokolle where id = ${protokollId}`;
		if (!z) return null;
		return { ...z, inhalt: typeof z.inhalt === 'string' ? JSON.parse(z.inhalt) : z.inhalt } as Protokoll;
	});
}

/**
 * Gibt alle Protokolle eines Auftrags zurück (ohne bytea-Felder).
 */
export async function protokolleFuerAuftrag(k: Kontext, auftragId: string): Promise<Protokoll[]> {
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			select id, auftrag_id as "auftragId", typ, inhalt,
				(unterschrift is not null) as "unterschriftVorhanden",
				(pdf is not null) as "pdfVorhanden",
				angelegt, geaendert, von_benutzer_id as "vonBenutzerId"
			from app.baustellen_protokolle where auftrag_id = ${auftragId}
			order by angelegt desc`;
		return zeilen.map((z) => ({ ...z, inhalt: typeof z.inhalt === 'string' ? JSON.parse(z.inhalt) : z.inhalt })) as Protokoll[];
	});
}