import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';

/**
 * Zustand der automatischen Funktionen für die Übersicht „Funktionen & Automatisierungen“ (Jamil msg 3423).
 * Liest nur; umgelegt werden kann genau das, was EIN Schalter in `portal_einstellungen` ist (Auftragsbestätigung
 * automatisch, Karte für Bestandskunden). Alles andere hat eigene Einstellungen mit mehreren Werten.
 */
export type FunktionenStand = {
	ab_automatisch: boolean;
	bestand_aktiv: boolean;
	nachfassen: { aktiv: number; gesamt: number };
	buchung: { terminarten: number };
	portalLinks: { kunden: number };
};

export async function ladeFunktionenStand(k: Kontext): Promise<FunktionenStand> {
	return mitBetrieb(k, async (tx) => {
		const [e] = await tx`select ab_automatisch, bestand_aktiv from app.portal_einstellungen where betrieb_id = ${k.betriebId}`;
		const [n] = await tx`select count(*) filter (where aktiv)::int as aktiv, count(*)::int as gesamt from app.nachfass_stufen where betrieb_id = ${k.betriebId}`;
		const [b] = await tx`select count(*)::int as n from app.buchung_dienste where betrieb_id = ${k.betriebId} and aktiv and online_buchbar`;
		const [p] = await tx`select count(distinct kunde_id)::int as n from app.portal_links where betrieb_id = ${k.betriebId} and kunde_id is not null and widerrufen_am is null and (laeuft_ab is null or laeuft_ab > now())`;
		return {
			ab_automatisch: e?.ab_automatisch ?? true,
			bestand_aktiv: e?.bestand_aktiv ?? true,
			nachfassen: { aktiv: n.aktiv, gesamt: n.gesamt },
			buchung: { terminarten: b.n },
			portalLinks: { kunden: p.n }
		};
	});
}

export const SCHALTER = ['ab_automatisch', 'bestand_aktiv'] as const;
export type SchalterName = (typeof SCHALTER)[number];

/** Legt genau einen der beiden Schalter um; alle anderen Werte der Einstellung bleiben unberührt. */
export async function setzeSchalter(k: Kontext, name: unknown, wert: unknown): Promise<void> {
	if (name !== 'ab_automatisch' && name !== 'bestand_aktiv') throw new ApiFehler(400, 'Unbekannter Schalter.');
	if (wert !== 'an' && wert !== 'aus') throw new ApiFehler(400, 'Bitte „an“ oder „aus“ angeben.');
	const an = wert === 'an';
	await mitBetrieb(k, (tx) =>
		name === 'ab_automatisch'
			? tx`insert into app.portal_einstellungen (betrieb_id, ab_automatisch) values (${k.betriebId}, ${an})
				on conflict (betrieb_id) do update set ab_automatisch = excluded.ab_automatisch`
			: tx`insert into app.portal_einstellungen (betrieb_id, bestand_aktiv) values (${k.betriebId}, ${an})
				on conflict (betrieb_id) do update set bestand_aktiv = excluded.bestand_aktiv`
	);
}
