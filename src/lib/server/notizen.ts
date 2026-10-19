import { mitBetrieb, type Kontext } from './db';

/**
 * Notizen zu Aufträgen. Freitext-Notizen je Auftrag.
 */

export type Notiz = {
	id: string;
	auftragId: string;
	text: string;
	angelegt: string;
	geaendert: string;
	vonBenutzerId: string | null;
};

/** Alle Notizen eines Auftrags (neueste zuerst). */
export async function notizenFuerAuftrag(k: Kontext, auftragId: string): Promise<Notiz[]> {
	return mitBetrieb(k, async (tx) => {
		return tx<Notiz[]>`
			select id, auftrag_id as "auftragId", text, angelegt, geaendert,
				von_benutzer_id as "vonBenutzerId"
			from app.notizen
			where betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId}
			order by angelegt desc
		`;
	});
}

/** Neue Notiz anlegen. */
export async function notizAnlegen(
	k: Kontext,
	auftragId: string,
	text: string,
	vonBenutzerId?: string
): Promise<Notiz> {
	return mitBetrieb(k, async (tx) => {
		const [n] = await tx<Notiz[]>`
			insert into app.notizen (betrieb_id, auftrag_id, text, von_benutzer_id)
			values (${k.betriebId}, ${auftragId}, ${text}, ${vonBenutzerId ?? null})
			returning id, auftrag_id as "auftragId", text, angelegt, geaendert,
				von_benutzer_id as "vonBenutzerId"
		`;
		return n;
	});
}

/** Notiz aktualisieren. */
export async function notizAktualisieren(
	k: Kontext,
	notizId: string,
	text: string
): Promise<Notiz | null> {
	return mitBetrieb(k, async (tx) => {
		const [n] = await tx<Notiz[]>`
			update app.notizen set text = ${text}, geaendert = now()
			where id = ${notizId} and betrieb_id = ${k.betriebId}
			returning id, auftrag_id as "auftragId", text, angelegt, geaendert,
				von_benutzer_id as "vonBenutzerId"
		`;
		return n ?? null;
	});
}

/** Notiz löschen. */
export async function notizLoeschen(k: Kontext, notizId: string): Promise<boolean> {
	return mitBetrieb(k, async (tx) => {
		const [n] = await tx<[{ id: string }?]>`
			delete from app.notizen
			where id = ${notizId} and betrieb_id = ${k.betriebId}
			returning id
		`;
		return !!n;
	});
}