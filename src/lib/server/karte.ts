import { mitBetrieb, type Kontext } from './db';
import { userAgent } from './kacheln';
import { ApiFehler } from './fehler';
import { AUSWAHL, VON, sichtbar, zuAuftrag, type Auftrag, type Sicht } from './auftraege';
import { UUID } from './kunden';
import { istStatus, type AuftragStatus } from '../auftrag-status';
import { ausTagUndUhrzeit, berlinTag, berlinUhrzeit, istTag, tagPlus } from '../zeit';

/**
 * Auftragskarte (Wunsch Jamil msg 2602): Aufträge als Punkte an ihrer Adresse (Objekt, sonst Kunde bzw.
 * Einmal-Kunde), Farbe nach Status, Filter; Route „Termine heute“ für einen Mitarbeiter oder eine Kolonne.
 * Sichtbarkeit wie überall: wer nur eigene Aufträge sieht (Monteur), sieht nur diese auf der Karte.
 *
 * Koordinaten: app.geo_adressen je Betrieb. Fehlende Adressen sucht ein Hintergrund-Job über Nominatim
 * (OpenStreetMap) – höchstens eine Anfrage pro Sekunde für den ganzen Server, eigener User-Agent (Nutzungsregeln).
 */

export type KartenAuftrag = Auftrag & { lat: number | null; lng: number | null; geoStatus: 'offen' | 'gefunden' | 'nicht_gefunden' | 'fehler' | null; ungefaehr: boolean };

export type KartenFilter = {
	status?: AuftragStatus[];
	benutzerId?: string;
	kolonneId?: string;
	von?: string;
	bis?: string;
	quelleId?: string;
};

/** Adresse als Schlüssel: Leerraum vereinheitlicht, höchstens 400 Zeichen. */
export const normalAdresse = (a: string) => a.replace(/\s+/g, ' ').trim().slice(0, 400);

// ——— Geokodierung (Nominatim, 1 Anfrage/Sekunde) ———

const ABSTAND_MS = 1100;
const MAX_VERSUCHE = 3;
type Auftrag_ = { k: Kontext; adresse: string };
const warteschlange: Auftrag_[] = [];
const inWarteschlange = new Set<string>();
let laeuft = false;
/** Nur Tests: anderer Geokodierer (ohne Netz). */
export let geokodierer: (adresse: string) => Promise<{ lat: number; lng: number } | null> = nominatim;
export const setzeGeokodierer = (f: typeof geokodierer) => (geokodierer = f);

async function nominatim(adresse: string): Promise<{ lat: number; lng: number } | null> {
	const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de,at,ch&accept-language=de&q=${encodeURIComponent(adresse)}`;
	const r = await fetch(url, { headers: { 'user-agent': userAgent(), accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
	if (!r.ok) throw new Error(`Nominatim ${r.status}`);
	const liste = (await r.json()) as { lat: string; lon: string }[];
	if (!Array.isArray(liste) || liste.length === 0) return null;
	const lat = Number(liste[0].lat);
	const lng = Number(liste[0].lon);
	return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** „Straße 1, 22846 Norderstedt“ → „22846 Norderstedt“ (Rückfall, wenn die genaue Adresse unbekannt ist). */
export function plzOrt(adresse: string): string | null {
	const m = /(?:^|,)\s*(\d{4,5}\s+[^,]+?)\s*$/.exec(adresse);
	return m && m[1] !== adresse.trim() ? m[1] : null;
}

async function abarbeiten(): Promise<void> {
	if (laeuft) return;
	laeuft = true;
	try {
		while (warteschlange.length > 0) {
			const { k, adresse } = warteschlange.shift()!;
			inWarteschlange.delete(`${k.betriebId}|${adresse}`);
			let status: 'gefunden' | 'nicht_gefunden' | 'fehler' = 'fehler';
			let punkt: { lat: number; lng: number } | null = null;
			let ungefaehr = false;
			try {
				punkt = await geokodierer(adresse);
				const grob = punkt ? null : plzOrt(adresse);
				if (grob) {
					if (geokodierer === nominatim) await new Promise((ok) => setTimeout(ok, ABSTAND_MS));
					punkt = await geokodierer(grob);
					ungefaehr = punkt !== null;
				}
				status = punkt ? 'gefunden' : 'nicht_gefunden';
			} catch (e) {
				console.error('Geokodierung fehlgeschlagen:', (e as Error).message);
			}
			try {
				await mitBetrieb(k, (tx) => tx`
					update app.geo_adressen set status = ${status}, lat = ${punkt?.lat ?? null}, lng = ${punkt?.lng ?? null}, ungefaehr = ${ungefaehr},
						versuche = versuche + 1, abgefragt = now()
					where betrieb_id = ${k.betriebId} and adresse = ${adresse}`);
			} catch (e) {
				console.error('Geokodierung speichern fehlgeschlagen:', e);
			}
			if (warteschlange.length > 0 && geokodierer === nominatim) await new Promise((ok) => setTimeout(ok, ABSTAND_MS));
		}
	} finally {
		laeuft = false;
	}
}

/** Adressen merken und im Hintergrund suchen (bereits bekannte werden übersprungen). */
export async function merkeAdressen(k: Kontext, adressen: (string | null | undefined)[]): Promise<void> {
	const liste = [...new Set(adressen.filter((a): a is string => !!a && a.trim().length >= 3).map(normalAdresse))];
	if (liste.length === 0) return;
	const offen = await mitBetrieb(k, async (tx) => {
		await tx`
			insert into app.geo_adressen (betrieb_id, adresse)
			select ${k.betriebId}, a from unnest(${liste}::text[]) as a
			on conflict do nothing`;
		return tx`
			select adresse from app.geo_adressen
			where betrieb_id = ${k.betriebId} and adresse = any(${liste}::text[])
				and (status = 'offen' or (status = 'fehler' and versuche < ${MAX_VERSUCHE}))`;
	});
	for (const { adresse } of offen) {
		const s = `${k.betriebId}|${adresse}`;
		if (inWarteschlange.has(s)) continue;
		inWarteschlange.add(s);
		warteschlange.push({ k, adresse });
	}
	void abarbeiten();
}

/** Nur Tests: warten, bis die Warteschlange leer ist. */
export async function warteAufGeokodierung(): Promise<void> {
	while (laeuft || warteschlange.length > 0) await new Promise((ok) => setTimeout(ok, 10));
}

// ——— Karte ———

function pruefeFilter(f: KartenFilter): void {
	if (f.status) for (const s of f.status) if (!istStatus(s)) throw new ApiFehler(400, 'Unbekannter Status.');
	for (const id of [f.benutzerId, f.kolonneId]) if (id !== undefined && !UUID.test(id)) throw new ApiFehler(400, 'Ungültige Auswahl.');
	if (f.quelleId !== undefined && f.quelleId !== 'ohne' && !UUID.test(f.quelleId)) throw new ApiFehler(400, 'Ungültige Auftragsquelle.');
	for (const t of [f.von, f.bis]) if (t !== undefined && !istTag(t)) throw new ApiFehler(400, 'Ungültiges Datum.');
}

/**
 * Aufträge für die Karte (höchstens 300). Standard: alle außer „abgerechnet“. Mitarbeiter: zuständig oder mit
 * Termin (im Zeitraum, falls gesetzt); Kolonne: mit Kolonnen-Termin; Zeitraum allein: Aufträge mit Termin darin.
 * Fehlende Koordinaten werden im Hintergrund gesucht.
 */
export async function ladeKarte(k: Kontext, sicht: Sicht, f: KartenFilter): Promise<{ auftraege: KartenAuftrag[]; offen: number }> {
	pruefeFilter(f);
	const status = f.status && f.status.length > 0 ? f.status : (['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen'] as AuftragStatus[]);
	const ab = f.von ? ausTagUndUhrzeit(f.von, '00:00') : null;
	const bis = f.bis ? ausTagUndUhrzeit(tagPlus(f.bis, 1), '00:00') : null;
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
		where a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}
			and a.status = any(${status}::text[])
			${f.quelleId ? (f.quelleId === 'ohne' ? tx`and a.quelle_id is null` : tx`and a.quelle_id = ${f.quelleId}`) : tx``}
			${
				f.benutzerId
					? tx`and (exists (select 1 from app.einsaetze e where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id
							and e.benutzer_id = ${f.benutzerId}
							${ab ? tx`and e.ende > ${ab}` : tx``} ${bis ? tx`and e.beginn < ${bis}` : tx``})
						${ab || bis ? tx`` : tx`or exists (select 1 from app.auftrag_zustaendige z where z.auftrag_id = a.id
							and z.betrieb_id = a.betrieb_id and z.benutzer_id = ${f.benutzerId})`})`
					: tx``
			}
			${
				f.kolonneId
					? tx`and exists (select 1 from app.einsaetze e where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id
						and e.kolonne_id = ${f.kolonneId} ${ab ? tx`and e.ende > ${ab}` : tx``} ${bis ? tx`and e.beginn < ${bis}` : tx``})`
					: tx``
			}
			${
				!f.benutzerId && !f.kolonneId && (ab || bis)
					? tx`and exists (select 1 from app.einsaetze e where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id
						${ab ? tx`and e.ende > ${ab}` : tx``} ${bis ? tx`and e.beginn < ${bis}` : tx``})`
					: tx``
			}
		order by a.angelegt desc
		limit 300`);
	const auftraege = zeilen.map(zuAuftrag);
	const adressen = [...new Set(auftraege.map((a) => a.adresse).filter((x): x is string => !!x).map(normalAdresse))];
	const geo = adressen.length
		? await mitBetrieb(k, (tx) => tx`
			select adresse, lat, lng, status, ungefaehr from app.geo_adressen where betrieb_id = ${k.betriebId} and adresse = any(${adressen}::text[])`)
		: [];
	const karte = new Map(geo.map((g) => [g.adresse as string, g]));
	await merkeAdressen(k, adressen.filter((a) => !karte.has(a) || karte.get(a)!.status === 'offen' || karte.get(a)!.status === 'fehler'));
	const mitGeo: KartenAuftrag[] = auftraege.map((a) => {
		const g = a.adresse ? karte.get(normalAdresse(a.adresse)) : undefined;
		return { ...a, lat: g?.lat ?? null, lng: g?.lng ?? null, geoStatus: g ? g.status : a.adresse ? 'offen' : null, ungefaehr: g?.ungefaehr === true };
	});
	return { auftraege: mitGeo, offen: mitGeo.filter((a) => a.geoStatus === 'offen' || a.geoStatus === 'fehler').length };
}

/** Startpunkt der Route: Adresse aus dem Briefkopf (mit Koordinaten, falls schon gefunden). */
export async function firmenStart(k: Kontext): Promise<{ adresse: string; lat: number | null; lng: number | null } | null> {
	const [p] = await mitBetrieb(k, (tx) => tx`select strasse, plz, ort from app.betrieb_profil where betrieb_id = ${k.betriebId}`);
	const adresse = p ? normalAdresse([p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')) : '';
	if (adresse.length < 3) return null;
	await merkeAdressen(k, [adresse]);
	const [g] = await mitBetrieb(k, (tx) => tx`select lat, lng from app.geo_adressen where betrieb_id = ${k.betriebId} and adresse = ${adresse}`);
	return { adresse, lat: g?.lat ?? null, lng: g?.lng ?? null };
}

export type RoutenStopp = { auftragId: string; nummer: string; titel: string; kundeName: string; adresse: string | null; zeit: string; lat: number | null; lng: number | null };

/**
 * „Termine heute“ als Stopps (nach Uhrzeit) für einen Mitarbeiter oder eine Kolonne; je Auftrag ein Stopp.
 * Andere Personen nur mit „Alle To-dos ansehen“ – geprüft vom Aufrufer (darfPlanSehen).
 */
export async function termineAlsStopps(k: Kontext, sicht: Sicht, wer: { benutzerId?: string; kolonneId?: string }, tag = berlinTag(new Date())): Promise<RoutenStopp[]> {
	if (!wer.benutzerId && !wer.kolonneId) return [];
	const ab = ausTagUndUhrzeit(tag, '00:00');
	const bis = ausTagUndUhrzeit(tagPlus(tag, 1), '00:00');
	const zeilen = await mitBetrieb(k, (tx) => tx`
		select ${tx.unsafe(AUSWAHL)}, min(e.beginn) over (partition by a.id) as erster_beginn,
			row_number() over (partition by a.id order by e.beginn) as nr
		from ${tx.unsafe(VON)}
		join app.einsaetze e on e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id
		where a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} and e.beginn < ${bis} and e.ende > ${ab}
			${wer.benutzerId ? tx`and e.benutzer_id = ${wer.benutzerId}` : tx`and e.kolonne_id = ${wer.kolonneId!}`}`);
	const auftraege = zeilen.filter((z) => Number(z.nr) === 1).sort((x, y) => +new Date(x.erster_beginn) - +new Date(y.erster_beginn));
	const stopps = auftraege.map((z) => {
		const a = zuAuftrag(z);
		return { auftragId: a.id, nummer: a.nummer, titel: a.titel, kundeName: a.kundeName, adresse: a.adresse, zeit: berlinUhrzeit(new Date(z.erster_beginn)), lat: null as number | null, lng: null as number | null };
	});
	const adressen = stopps.map((s) => s.adresse).filter((x): x is string => !!x).map(normalAdresse);
	if (adressen.length > 0) {
		await merkeAdressen(k, adressen);
		const geo = await mitBetrieb(k, (tx) => tx`select adresse, lat, lng from app.geo_adressen where betrieb_id = ${k.betriebId} and adresse = any(${adressen}::text[])`);
		const m = new Map(geo.map((g) => [g.adresse as string, g]));
		for (const s of stopps) {
			const g = s.adresse ? m.get(normalAdresse(s.adresse)) : undefined;
			s.lat = g?.lat ?? null;
			s.lng = g?.lng ?? null;
		}
	}
	return stopps;
}
