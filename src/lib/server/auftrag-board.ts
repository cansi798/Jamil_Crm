import { mitBetrieb, type Kontext } from './db';
import { likeMuster, sucheWoerter } from './kunden';
import { AUSWAHL, NACHFASSEN_FAELLIG_SQL, sichtbar, VON, zuAuftrag, type Auftrag, type Sicht } from './auftraege';
import { STATUS, type AuftragStatus } from '../auftrag-status';

/**
 * Daten für das Auftrags-Board (Kacheln je Status, Wunsch Jamil): je Spalte die neuesten Aufträge (höchstens
 * `MAX_JE_SPALTE`) plus die Gesamtzahl der Spalte. Sichtbarkeit wie in der Liste (`sichtbar`: mit nur
 * `auftraege.lesen` nur eigene Aufträge). Zusätzlich je Karte der nächste Termin (Einsatz, der noch nicht vorbei
 * ist) und – nur mit `mitPreisen` – der Nettowert des maßgeblichen Angebots (angenommen vor versendet vor
 * Entwurf, jeweils das neueste; abgelehnte zählen nicht).
 */

export const MAX_JE_SPALTE = 50;

export type BoardKarte = Auftrag & {
	/** Beginn des nächsten Einsatzes (ISO) oder null. */
	naechsterTermin: string | null;
	/** Nettowert in Cent – nur mit Preisrecht, sonst immer null. */
	angebotNettoCent: number | null;
	angebotStatus: string | null;
};

export type Board = {
	spalten: { status: AuftragStatus; anzahl: number; karten: BoardKarte[] }[];
};

/** `meine`: nur Aufträge mit Bezug zum Nutzer (zuständig, eigenes To-do oder eigener Termin) – wie in der Liste. */
export type BoardOptionen = { suche?: string; meine?: boolean; mitPreisen: boolean; /** UUID oder „ohne“ */ quelleId?: string; nachfassenFaellig?: boolean };

export async function ladeBoard(k: Kontext, sicht: Sicht, opt: BoardOptionen): Promise<Board> {
	const muster = sucheWoerter(opt.suche).map(likeMuster);
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			with treffer as (
				select ${tx.unsafe(AUSWAHL)},
					(select min(e.beginn) from app.einsaetze e
						where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id and e.ende > now()) as naechster_termin,
					count(*) over (partition by a.status) as anzahl,
					row_number() over (partition by a.status order by a.angelegt desc, a.nummer desc) as rang
				from ${tx.unsafe(VON)}
				where a.betrieb_id = ${k.betriebId}
					and ${sichtbar(tx, sicht)}
					${opt.meine ? tx`and ${sichtbar(tx, { alle: false, benutzerId: sicht.benutzerId })}` : tx``}
					${opt.quelleId ? (opt.quelleId === 'ohne' ? tx`and a.quelle_id is null` : tx`and a.quelle_id = ${opt.quelleId}`) : tx``}
					${opt.nachfassenFaellig ? tx`and ${tx.unsafe(NACHFASSEN_FAELLIG_SQL)}` : tx``}
					and not exists (
						select 1 from unnest(${muster}::text[]) as s(m)
						where not (
							lower(a.nummer) like lower(s.m)
							or lower(a.titel) like lower(s.m)
							or lower(coalesce(k.firma, '')) like lower(s.m)
							or lower(coalesce(k.vorname, '')) like lower(s.m)
							or lower(coalesce(k.nachname, '')) like lower(s.m)
							or lower(coalesce(a.einmal_name, '')) like lower(s.m)
						)
					)
			)
			select t.*, ang.status as angebot_status, ang.netto_cent as angebot_netto_cent
			from treffer t
			left join lateral (
				select an.status,
					(select coalesce(sum(round(p.menge * p.einzelpreis_cent)), 0)::bigint
						from app.angebot_positionen p
						where p.angebot_id = an.id and p.betrieb_id = an.betrieb_id) as netto_cent
				from app.angebote an
				where ${opt.mitPreisen} and an.auftrag_id = t.id and an.betrieb_id = ${k.betriebId}
					and an.status <> 'abgelehnt'
				order by case an.status when 'angenommen' then 0 when 'versendet' then 1 else 2 end, an.angelegt desc
				limit 1
			) ang on true
			where t.rang <= ${MAX_JE_SPALTE}
			order by t.angelegt desc, t.nummer desc`;
		const spalten = STATUS.map((status) => ({ status, anzahl: 0, karten: [] as BoardKarte[] }));
		for (const z of zeilen) {
			const spalte = spalten.find((s) => s.status === z.status);
			if (!spalte) continue;
			spalte.anzahl = Number(z.anzahl);
			spalte.karten.push({
				...zuAuftrag(z),
				naechsterTermin: z.naechster_termin ? new Date(z.naechster_termin).toISOString() : null,
				angebotNettoCent: opt.mitPreisen && z.angebot_netto_cent !== null ? Number(z.angebot_netto_cent) : null,
				angebotStatus: opt.mitPreisen ? (z.angebot_status ?? null) : null
			});
		}
		return { spalten };
	});
}
