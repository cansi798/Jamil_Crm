import { mitBetrieb, type Kontext } from './db';
import { hatRecht } from './rechte';
import { siehtKennzahlen } from './kennzahlen';
import { KENNZAHL_IDS, KENNZAHLEN } from '../kennzahlen';
import { bereinigeLayout, kennzahlKachelId, standardLayout, type StartLayout, type StartRolle } from '../start-kacheln';
import { berlinTag, tagPlus } from '../zeit';
import { ERINNERN_TAGE, NACHWEIS_ART_NAMEN, nachweisStatus, type NachweisArt } from '../partner';

/**
 * Start-Layout je Benutzer (Jamil msg 2942; Migration 095). Welche Kacheln jemand bekommt, hängt an Modulen und
 * Rechten – Kacheln mit Beträgen nur mit „Preise sehen“, Kennzahlen nur mit „Alle Aufträge ansehen“, Partner-Nachweise
 * nur mit „Partner verwalten“. Nicht erlaubte Kacheln werden weder angeboten noch geladen noch gezeigt.
 */

export function erlaubteKacheln(nutzer: Nutzer, module: readonly string[]): Set<string> {
	const e = new Set<string>(['bereiche']);
	const auftraege = module.includes('auftraege') && (hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen') || hatRecht(nutzer, 'auftraege.bearbeiten'));
	if (!auftraege) return e;
	const preise = hatRecht(nutzer, 'preise.sehen');
	e.add('heute');
	if (module.includes('zeiterfassung') && (hatRecht(nutzer, 'zeiterfassung.nutzen') || hatRecht(nutzer, 'zeiterfassung.alle_sehen'))) e.add('zeiterfassung');
	if (module.includes('plantafel') && preise) e.add('monat');
	if (siehtKennzahlen(nutzer, module)) {
		for (const id of ['handlung', 'nachfassen', 'kennzahlen', 'auslastung']) e.add(id);
		const mitPreisen = preise && module.includes('angebote');
		if (mitPreisen) e.add('quellen');
		for (const id of KENNZAHL_IDS) if (!KENNZAHLEN[id].preis || mitPreisen) e.add(kennzahlKachelId(id));
		if (module.includes('plantafel')) e.add('buchungen');
	}
	if (hatRecht(nutzer, 'partner.verwalten')) e.add('nachweise'); // Modul „auftraege“ ist oben schon geprüft
	return e;
}

/** Vorgabe-Rolle für das Standard-Layout: Chef (Einstellungen), Büro (alle Aufträge), sonst Monteur. */
export function startRolle(nutzer: Nutzer): StartRolle {
	if (hatRecht(nutzer, 'einstellungen') && hatRecht(nutzer, 'auftraege.alle_lesen')) return 'chef';
	if (hatRecht(nutzer, 'auftraege.alle_lesen')) return 'buero';
	return 'monteur';
}

/** Layout der Person (gespeichert, sonst Vorgabe der Rolle); `eigenes` = es gibt ein gespeichertes. */
export async function ladeStartLayout(k: Kontext, erlaubt: ReadonlySet<string>, rolle: StartRolle): Promise<{ layout: StartLayout; eigenes: boolean }> {
	const [z] = await mitBetrieb(k, (tx) => tx`select kacheln from app.start_layouts where benutzer_id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`);
	if (!z) return { layout: standardLayout(rolle, erlaubt), eigenes: false };
	return { layout: bereinigeLayout(z.kacheln, erlaubt), eigenes: true };
}

/** Speichern (vorher mit `pruefeLayout` geprüft). */
export async function speichereStartLayout(k: Kontext, layout: StartLayout): Promise<void> {
	await mitBetrieb(k, (tx) => tx`
		insert into app.start_layouts (benutzer_id, betrieb_id, kacheln) values (${k.benutzerId}, ${k.betriebId}, ${tx.json(layout)})
		on conflict (benutzer_id) do update set kacheln = excluded.kacheln`);
}

/** „Standard wiederherstellen“: eigenes Layout löschen → wieder Vorgabe der Rolle. */
export async function loescheStartLayout(k: Kontext): Promise<void> {
	await mitBetrieb(k, (tx) => tx`delete from app.start_layouts where benutzer_id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`);
}

export type NeueBuchung = { id: string; name: string; beginn: string; auftragId: string | null };

/** Online-Buchungen der letzten 7 Tage (aktiv), neueste zuerst. */
export async function neueBuchungen(k: Kontext, jetzt = new Date()): Promise<{ anzahl: number; liste: NeueBuchung[] }> {
	const seit = new Date(jetzt.getTime() - 7 * 86_400_000);
	const z = await mitBetrieb(k, (tx) => tx`
		select id, concat_ws(' ', vorname, nachname) as name, beginn, auftrag_id, count(*) over ()::int as anzahl
		from app.buchungen where betrieb_id = ${k.betriebId} and status = 'aktiv' and angelegt >= ${seit}
		order by angelegt desc limit 6`);
	return {
		anzahl: z[0]?.anzahl ?? 0,
		liste: z.map((r) => ({ id: r.id, name: r.name, beginn: new Date(r.beginn).toISOString(), auftragId: r.auftrag_id }))
	};
}

export type AblaufenderNachweis = { partnerId: string; partner: string; art: string; gueltigBis: string; abgelaufen: boolean };

/** Nachweise aktiver Partner, die abgelaufen sind oder in den nächsten 30 Tagen ablaufen. */
export async function ablaufendeNachweise(k: Kontext, heute = berlinTag(new Date())): Promise<AblaufenderNachweis[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select p.id as partner_id, p.name, n.art, to_char(n.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis
		from app.partner_nachweise n join app.partner p on p.id = n.partner_id and p.betrieb_id = n.betrieb_id
		where n.betrieb_id = ${k.betriebId} and p.aktiv and n.gueltig_bis is not null and n.gueltig_bis <= ${tagPlus(heute, ERINNERN_TAGE)}::date
		order by n.gueltig_bis limit 8`);
	return z.map((r) => ({
		partnerId: r.partner_id,
		partner: r.name,
		art: NACHWEIS_ART_NAMEN[r.art as NachweisArt] ?? r.art,
		gueltigBis: r.gueltig_bis,
		abgelaufen: nachweisStatus(r.gueltig_bis, heute) === 'abgelaufen'
	}));
}
