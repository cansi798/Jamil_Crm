import { mitBetrieb, type Kontext } from './db';
import { listeAuftraege, sichtbar, sichtVon } from './auftraege';
import { listeAngebote } from './angebote';
import { listeKundenDateien, listeKundenNotizen } from './kundenakte';
import { hatRecht } from './rechte';
import { hatModul } from './tarif';
import { STATUS_NAMEN } from '../auftrag-status';
import { ANGEBOT_STATUS_NAMEN } from '../angebot-status';
import { EINSATZ_ART_NAMEN, type EinsatzArt } from '../einsatz-art';
import { euro } from '../geld';
import { berlinTag, berlinUhrzeit, tagDeutsch } from '../zeit';

/**
 * Verlauf eines Kunden als Zeitleiste (Wunsch Jamil, Phase 4): Aufträge, Angebote (mit und ohne Auftrag), Termine,
 * Notizen und Dokumente – neueste bzw. geplante zuerst. Jede Art nur mit dem Recht, mit dem man sie auch sonst sieht:
 * Aufträge und Termine wie die Auftragsliste (alle oder eigene), Angebote nur mit „Angebote bearbeiten“ und „Preise
 * sehen“, Notizen/Dokumente mit „Kunden ansehen“ (prüft die Kundenseite). Rechnungen und E-Mails folgen, sobald es sie
 * gibt. Termine legt man nur im Auftrag an – hier stehen sie nur.
 */

export type VerlaufTyp = 'auftrag' | 'angebot' | 'termin' | 'notiz' | 'dokument';

export type ZeitleistenEintrag = {
	id: string;
	typ: VerlaufTyp;
	/** ISO-Zeitpunkt (Termin: Beginn, Angebot: Angebotsdatum, sonst Anlage). */
	zeit: string;
	titel: string;
	text: string | null;
	link: string | null;
};

export const MAX_EINTRAEGE = 300;

export async function kundenVerlauf(k: Kontext, nutzer: Nutzer, kundeId: string): Promise<ZeitleistenEintrag[]> {
	const sicht = sichtVon(nutzer);
	const auftraegeLesbar =
		(hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen')) && (await hatModul(k.betriebId, 'auftraege'));
	const angeboteLesbar =
		hatRecht(nutzer, 'angebote.bearbeiten') && hatRecht(nutzer, 'preise.sehen') && (await hatModul(k.betriebId, 'angebote'));

	const [auftraege, termine, angebote, notizen, dokumente] = await Promise.all([
		auftraegeLesbar ? listeAuftraege(k, sicht, { kundeId }) : Promise.resolve([]),
		auftraegeLesbar
			? mitBetrieb(k, (tx) => tx`
				select e.id, e.beginn, e.ende, e.art, e.notiz, a.id as auftrag_id, a.nummer, a.titel, b.name as benutzer_name
				from app.einsaetze e
				join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
				join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id
				where e.betrieb_id = ${k.betriebId} and a.kunde_id = ${kundeId} and ${sichtbar(tx, sicht)}
				order by e.beginn desc
				limit ${MAX_EINTRAEGE}`)
			: Promise.resolve([]),
		angeboteLesbar
			? listeAngebote(k, { kundeId }, { sicht, auftragAendern: hatRecht(nutzer, 'auftraege.bearbeiten') })
			: Promise.resolve([]),
		listeKundenNotizen(k, kundeId),
		listeKundenDateien(k, kundeId)
	]);

	const eintraege: ZeitleistenEintrag[] = [
		...auftraege.map((a) => ({
			id: `auftrag-${a.id}`,
			typ: 'auftrag' as const,
			zeit: a.angelegt,
			titel: `Auftrag ${a.nummer} angelegt: ${a.titel}`,
			text: `Status: ${STATUS_NAMEN[a.status]}`,
			link: `/auftraege/${a.id}`
		})),
		...termine.map((t) => {
			const beginn = new Date(t.beginn);
			const ende = new Date(t.ende);
			const art = EINSATZ_ART_NAMEN[t.art as EinsatzArt] ?? 'Termin';
			return {
				id: `termin-${t.id}`,
				typ: 'termin' as const,
				zeit: beginn.toISOString(),
				titel: `${art} am ${tagDeutsch(berlinTag(beginn))}, ${berlinUhrzeit(beginn)}–${berlinUhrzeit(ende)} Uhr`,
				text: [`${t.nummer} ${t.titel}`, t.benutzer_name, t.notiz].filter(Boolean).join(' · '),
				link: `/auftraege/${t.auftrag_id}`
			};
		}),
		...angebote.map((a) => ({
			id: `angebot-${a.id}`,
			typ: 'angebot' as const,
			// Angebotsdatum (Tag) – mit der Anlage-Uhrzeit, damit die Reihenfolge innerhalb eines Tages stimmt
			zeit: a.datum === berlinTag(new Date(a.angelegt)) ? a.angelegt : `${a.datum}T12:00:00.000Z`,
			titel: `Angebot ${a.nummer} · ${ANGEBOT_STATUS_NAMEN[a.status]} · ${euro(a.bruttoCent)}`,
			text: a.auftragNummer ? `${a.auftragNummer} ${a.auftragTitel}` : 'ohne Auftrag',
			link: `/angebote/${a.id}`
		})),
		...notizen.map((n) => ({
			id: `notiz-${n.id}`,
			typ: 'notiz' as const,
			zeit: n.angelegt,
			titel: `Notiz${n.vonName ? ` von ${n.vonName}` : ''}`,
			text: n.text,
			link: null
		})),
		...dokumente.map((d) => ({
			id: `dokument-${d.id}`,
			typ: 'dokument' as const,
			zeit: d.angelegt,
			titel: `Dokument: ${d.name}`,
			text: d.beschreibung,
			link: `/kunden/${kundeId}/dokumente/${d.id}`
		}))
	];
	return eintraege.sort((a, b) => (a.zeit < b.zeit ? 1 : a.zeit > b.zeit ? -1 : 0)).slice(0, MAX_EINTRAEGE);
}
