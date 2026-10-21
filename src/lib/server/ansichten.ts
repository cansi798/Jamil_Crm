import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { hatRecht } from './rechte';
import { filterQuery } from '../ansichten';

/**
 * Gespeicherte Ansichten (Wunsch Jamil, Talk msgs 2830, 2921): Filter einer Seite (Query der Adresse) unter einem Namen.
 * Eigene sieht und ändert nur der Ersteller; geteilte (nur wer „Alle Aufträge ansehen“ hat, also Chef/Büro) sehen alle
 * im Betrieb – gespeichert sind nur Filter, die Daten zeigt jede Seite weiter nach den Rechten des Betrachters.
 * Durchgesetzt auch per RLS (Migration 090).
 */

export const ANSICHT_SEITEN = ['plantafel', 'karte', 'auftraege', 'todos', 'angebote', 'kunden', 'zeiten', 'nachkalkulation'] as const;
export type AnsichtSeite = (typeof ANSICHT_SEITEN)[number];
export const istAnsichtSeite = (w: unknown): w is AnsichtSeite => typeof w === 'string' && (ANSICHT_SEITEN as readonly string[]).includes(w);

export type Ansicht = { id: string; seite: AnsichtSeite; name: string; query: string; istStandard: boolean; geteilt: boolean; eigene: boolean; von: string | null };

export const MAX_ANSICHTEN_JE_SEITE = 30;
const MAX_PARAMETER = 30;

/**
 * Query normalisieren: ohne „?“, nur einfache Schlüssel, höchstens 30 Parameter und 2.000 Zeichen; alles wird von
 * URLSearchParams kodiert (keine Leer- oder Sonderzeichen im gespeicherten Text).
 */
export function normalisiereQuery(w: unknown, seite = ''): string {
	if (typeof w !== 'string') throw new ApiFehler(400, 'Ungültige Filter.');
	const roh = filterQuery(seite, w.trim().replace(/^\?/, ''));
	if (roh.length > 4000) throw new ApiFehler(400, 'Zu viele Filter.');
	const ein = new URLSearchParams(roh);
	const aus = new URLSearchParams();
	let n = 0;
	for (const [k, v] of ein) {
		if (!/^[a-z][a-z0-9_]{0,39}$/i.test(k) || v.length > 500) continue;
		if (++n > MAX_PARAMETER) throw new ApiFehler(400, 'Zu viele Filter.');
		aus.append(k, v);
	}
	const q = aus.toString();
	if (q.length > 2000) throw new ApiFehler(400, 'Zu viele Filter.');
	return q;
}

const zuAnsicht = (z: Record<string, any>, ich: string): Ansicht => ({
	id: z.id,
	seite: z.seite,
	name: z.name,
	query: z.query,
	istStandard: z.ist_standard && z.benutzer_id === ich,
	geteilt: z.geteilt,
	eigene: z.benutzer_id === ich,
	von: z.benutzer_id === ich ? null : (z.von ?? null)
});

const pruefeSeite = (w: unknown): AnsichtSeite => {
	if (!istAnsichtSeite(w)) throw new ApiFehler(400, 'Unbekannte Seite.');
	return w;
};
const pruefeId = (w: unknown) => {
	if (typeof w !== 'string' || !UUID.test(w)) throw new ApiFehler(404, 'Ansicht nicht gefunden.');
	return w.toLowerCase();
};

/** Eigene und geteilte Ansichten einer Seite (eigene zuerst, Standard oben). */
export async function listeAnsichten(k: Kontext, seite: unknown): Promise<Ansicht[]> {
	const s = pruefeSeite(seite);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select a.id, a.seite, a.name, a.query, a.ist_standard, a.geteilt, a.benutzer_id, b.name as von
			from app.gespeicherte_ansichten a left join app.benutzer b on b.id = a.benutzer_id and b.betrieb_id = a.betrieb_id
			where a.betrieb_id = ${k.betriebId} and a.seite = ${s}
			order by (a.benutzer_id = ${k.benutzerId}) desc, a.ist_standard desc, public.unaccent(lower(a.name)), a.id`;
		return z.map((r) => zuAnsicht(r, k.benutzerId));
	});
}

export type AnsichtEingabe = { seite?: unknown; name?: unknown; query?: unknown; istStandard?: unknown; geteilt?: unknown };

const ja = (w: unknown) => w === true || w === 'true' || w === 'on' || w === 'ja';

/** Neue Ansicht aus den aktuellen Filtern. Teilen nur mit „Alle Aufträge ansehen“ (Chef/Büro). */
export async function speichereAnsicht(k: Kontext, nutzer: Nutzer, e: AnsichtEingabe): Promise<Ansicht> {
	const seite = pruefeSeite(e.seite);
	const name = textFeld(e.name, 'Name', 80);
	if (!name) throw new ApiFehler(400, 'Bitte einen Namen eingeben.');
	const query = normalisiereQuery(e.query ?? '', seite);
	const geteilt = ja(e.geteilt);
	if (geteilt && !hatRecht(nutzer, 'auftraege.alle_lesen')) throw new ApiFehler(403, 'Teilen fürs Team dürfen nur Chef und Büro.');
	const standard = ja(e.istStandard);
	return mitBetrieb(k, async (tx) => {
		const [{ n }] = await tx`select count(*)::int as n from app.gespeicherte_ansichten where benutzer_id = ${k.benutzerId} and seite = ${seite}`;
		if (n >= MAX_ANSICHTEN_JE_SEITE) throw new ApiFehler(400, `Höchstens ${MAX_ANSICHTEN_JE_SEITE} Ansichten je Seite.`);
		const [gleich] = await tx`select 1 from app.gespeicherte_ansichten where benutzer_id = ${k.benutzerId} and seite = ${seite} and lower(btrim(name)) = lower(${name})`;
		if (gleich) throw new ApiFehler(409, `Es gibt schon eine Ansicht „${name}“.`);
		if (standard) await tx`update app.gespeicherte_ansichten set ist_standard = false where benutzer_id = ${k.benutzerId} and seite = ${seite} and ist_standard`;
		const [z] = await tx`
			insert into app.gespeicherte_ansichten (betrieb_id, benutzer_id, seite, name, query, ist_standard, geteilt)
			values (${k.betriebId}, ${k.benutzerId}, ${seite}, ${name}, ${query}, ${standard}, ${geteilt})
			returning id, seite, name, query, ist_standard, geteilt, benutzer_id`;
		return zuAnsicht(z, k.benutzerId);
	});
}

/** Umbenennen, Filter ersetzen, Standard, Teilen – nur eigene (fremde: 404). */
export async function aendereAnsicht(k: Kontext, nutzer: Nutzer, id: unknown, e: AnsichtEingabe): Promise<Ansicht> {
	const aid = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`select seite, name, query, ist_standard, geteilt from app.gespeicherte_ansichten where id = ${aid} and betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} for update`;
		if (!alt) throw new ApiFehler(404, 'Ansicht nicht gefunden.');
		const name = e.name === undefined ? alt.name : textFeld(e.name, 'Name', 80);
		if (!name) throw new ApiFehler(400, 'Bitte einen Namen eingeben.');
		const query = e.query === undefined ? alt.query : normalisiereQuery(e.query, alt.seite);
		const geteilt = e.geteilt === undefined ? alt.geteilt : ja(e.geteilt);
		if (geteilt && !alt.geteilt && !hatRecht(nutzer, 'auftraege.alle_lesen')) throw new ApiFehler(403, 'Teilen fürs Team dürfen nur Chef und Büro.');
		const standard = e.istStandard === undefined ? alt.ist_standard : ja(e.istStandard);
		if (name.toLowerCase() !== String(alt.name).toLowerCase()) {
			const [gleich] = await tx`select 1 from app.gespeicherte_ansichten where benutzer_id = ${k.benutzerId} and seite = ${alt.seite} and lower(btrim(name)) = lower(${name}) and id <> ${aid}`;
			if (gleich) throw new ApiFehler(409, `Es gibt schon eine Ansicht „${name}“.`);
		}
		if (standard && !alt.ist_standard) await tx`update app.gespeicherte_ansichten set ist_standard = false where benutzer_id = ${k.benutzerId} and seite = ${alt.seite} and ist_standard`;
		const [z] = await tx`
			update app.gespeicherte_ansichten set name = ${name}, query = ${query}, ist_standard = ${standard}, geteilt = ${geteilt}
			where id = ${aid} and betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId}
			returning id, seite, name, query, ist_standard, geteilt, benutzer_id`;
		return zuAnsicht(z, k.benutzerId);
	});
}

/**
 * Löschen: eigene immer; eine geteilte Team-Ansicht eines anderen nur, wer teilen darf (Chef/Büro). Private Ansichten
 * anderer: 404 (auch die Datenbank lässt das nicht zu, Migration 092).
 */
export async function loescheAnsicht(k: Kontext, nutzer: Nutzer, id: unknown): Promise<void> {
	const aid = pruefeId(id);
	const teamAufraeumen = hatRecht(nutzer, 'auftraege.alle_lesen');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			delete from app.gespeicherte_ansichten
			where id = ${aid} and betrieb_id = ${k.betriebId}
				and (benutzer_id = ${k.benutzerId} or (geteilt and ${teamAufraeumen}))
			returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Ansicht nicht gefunden.');
	});
}
