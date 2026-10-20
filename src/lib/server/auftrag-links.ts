import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { sichtbar, type Sicht } from './auftraege';
import { textFeld, UUID } from './kunden';

/**
 * Links am Auftrag (Wunsch Jamil, Talk msg 2850): Webadressen, die Monteure brauchen – z. B. das Portal eines Partners mit
 * Abnahmeprotokollen. Sehen darf sie, wer den Auftrag sieht (auch Monteure, auch in „Heute“); anlegen, ändern und
 * löschen nur mit „Aufträge bearbeiten“. Nur http/https; ohne Zugangsdaten in der Adresse. Optional im Kundenportal
 * (Standard aus). Jede Änderung steht im Verlauf des Auftrags (Trigger `protokolliere`).
 */

export type AuftragLink = { id: string; titel: string; url: string; domain: string; notiz: string | null; imPortal: boolean };

export const MAX_LINKS_JE_AUFTRAG = 30;
const VERBOTEN = /[\s<>"'`\\\u0000-\u001f\u007f]/;

/**
 * Prüft und normalisiert eine Adresse. Erlaubt nur http(s), keine Zugangsdaten („nutzer:passwort@“), höchstens 2.000
 * Zeichen. Ohne Schema wird https:// ergänzt („portal.partner.de/abnahme“). Fehler → 400 mit deutscher Meldung.
 */
export function pruefeLinkUrl(w: unknown): string {
	if (typeof w !== 'string' || w.trim() === '') throw new ApiFehler(400, 'Bitte eine Webadresse eingeben.');
	let roh = w.trim();
	if (roh.length > 2000) throw new ApiFehler(400, 'Die Webadresse ist zu lang (höchstens 2.000 Zeichen).');
	if (!/^[a-z][a-z0-9+.-]*:/i.test(roh)) roh = `https://${roh}`;
	let u: URL;
	try {
		u = new URL(roh);
	} catch {
		throw new ApiFehler(400, 'Die Webadresse ist ungültig.');
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ApiFehler(400, 'Nur Webadressen mit http:// oder https:// sind erlaubt.');
	if (u.username || u.password) throw new ApiFehler(400, 'Bitte keine Zugangsdaten in der Webadresse speichern.');
	if (!u.hostname || (!u.hostname.includes('.') && u.hostname !== 'localhost')) throw new ApiFehler(400, 'Die Webadresse braucht eine Domain (z. B. partner.de).');
	const href = u.href;
	if (href.length > 2000 || VERBOTEN.test(href)) throw new ApiFehler(400, 'Die Webadresse enthält ungültige Zeichen.');
	return href;
}

/** Domain zur Anzeige („portal.partner.de“, ohne „www.“). */
export function domainVon(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

export type LinkWerte = { titel: string; url: string; notiz: string | null; imPortal: boolean };

export function pruefeLinkEingabe(e: Record<string, unknown>): LinkWerte {
	const url = pruefeLinkUrl(e.url);
	const titel = textFeld(e.titel, 'Titel', 200) ?? domainVon(url);
	return { titel, url, notiz: textFeld(e.notiz, 'Notiz', 500), imPortal: e.imPortal === true || e.imPortal === 'on' || e.imPortal === 'ja' };
}

const zuLink = (r: Record<string, any>): AuftragLink => ({ id: r.id, titel: r.titel, url: r.url, domain: domainVon(r.url), notiz: r.notiz, imPortal: r.im_portal });

async function auftragSichtbar(tx: TransactionSql, k: Kontext, sicht: Sicht, auftragId: string, sperren = false): Promise<void> {
	if (!UUID.test(auftragId)) throw new ApiFehler(404, 'Nicht gefunden.');
	const [a] = sperren
		? await tx`select 1 from app.auftraege a where a.id = ${auftragId} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for key share of a`
		: await tx`select 1 from app.auftraege a where a.id = ${auftragId} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}`;
	if (!a) throw new ApiFehler(404, 'Nicht gefunden.');
}

export async function listeLinks(k: Kontext, sicht: Sicht, auftragId: string): Promise<AuftragLink[]> {
	return mitBetrieb(k, async (tx) => {
		await auftragSichtbar(tx, k, sicht, auftragId);
		const z = await tx`select id, titel, url, notiz, im_portal from app.auftrag_links
			where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId} order by sortierung, angelegt, id`;
		return z.map(zuLink);
	});
}

/** Links mehrerer Aufträge (z. B. für „Heute“) – Aufrufer übergibt nur Aufträge, die der Nutzer sieht. */
export async function linksZuAuftraegen(k: Kontext, sicht: Sicht, auftragIds: readonly string[]): Promise<Map<string, AuftragLink[]>> {
	const ids = auftragIds.filter((id) => UUID.test(id));
	if (ids.length === 0) return new Map();
	const z = await mitBetrieb(k, (tx) => tx`
		select l.auftrag_id, l.id, l.titel, l.url, l.notiz, l.im_portal from app.auftrag_links l
		join app.auftraege a on a.id = l.auftrag_id and a.betrieb_id = l.betrieb_id
		where l.betrieb_id = ${k.betriebId} and l.auftrag_id = any(${ids}::uuid[]) and ${sichtbar(tx, sicht)}
		order by l.sortierung, l.angelegt, l.id`);
	const m = new Map<string, AuftragLink[]>();
	for (const r of z) m.set(r.auftrag_id, [...(m.get(r.auftrag_id) ?? []), zuLink(r)]);
	return m;
}

export async function legeLinkAn(k: Kontext, sicht: Sicht, auftragId: string, e: Record<string, unknown>): Promise<AuftragLink> {
	const w = pruefeLinkEingabe(e);
	return mitBetrieb(k, async (tx) => {
		await auftragSichtbar(tx, k, sicht, auftragId, true);
		const [n] = await tx`select count(*)::int as n, coalesce(max(sortierung), -1) + 1 as naechste from app.auftrag_links where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId}`;
		if (n.n >= MAX_LINKS_JE_AUFTRAG) throw new ApiFehler(400, `Höchstens ${MAX_LINKS_JE_AUFTRAG} Links je Auftrag.`);
		const [z] = await tx`
			insert into app.auftrag_links (betrieb_id, auftrag_id, titel, url, notiz, im_portal, sortierung, angelegt_von)
			values (${k.betriebId}, ${auftragId}, ${w.titel}, ${w.url}, ${w.notiz}, ${w.imPortal}, ${n.naechste}, ${k.benutzerId})
			returning id, titel, url, notiz, im_portal`;
		return zuLink(z);
	});
}

/** Ändert Titel, Adresse und Notiz – „im Kundenportal“ nur über `setzeLinkImPortal` (eigenes Recht). */
export async function aendereLink(k: Kontext, sicht: Sicht, auftragId: string, linkId: unknown, e: Record<string, unknown>): Promise<AuftragLink> {
	if (typeof linkId !== 'string' || !UUID.test(linkId)) throw new ApiFehler(404, 'Nicht gefunden.');
	const w = pruefeLinkEingabe(e);
	return mitBetrieb(k, async (tx) => {
		await auftragSichtbar(tx, k, sicht, auftragId);
		const [z] = await tx`
			update app.auftrag_links set titel = ${w.titel}, url = ${w.url}, notiz = ${w.notiz}
			where id = ${linkId} and auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId}
			returning id, titel, url, notiz, im_portal`;
		if (!z) throw new ApiFehler(404, 'Nicht gefunden.');
		return zuLink(z);
	});
}

export async function setzeLinkImPortal(k: Kontext, sicht: Sicht, auftragId: string, linkId: unknown, an: boolean): Promise<void> {
	if (typeof linkId !== 'string' || !UUID.test(linkId)) throw new ApiFehler(404, 'Nicht gefunden.');
	await mitBetrieb(k, async (tx) => {
		await auftragSichtbar(tx, k, sicht, auftragId);
		const z = await tx`update app.auftrag_links set im_portal = ${an} where id = ${linkId} and auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Nicht gefunden.');
	});
}

export async function loescheLink(k: Kontext, sicht: Sicht, auftragId: string, linkId: unknown): Promise<void> {
	if (typeof linkId !== 'string' || !UUID.test(linkId)) throw new ApiFehler(404, 'Nicht gefunden.');
	await mitBetrieb(k, async (tx) => {
		await auftragSichtbar(tx, k, sicht, auftragId);
		const z = await tx`delete from app.auftrag_links where id = ${linkId} and auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Nicht gefunden.');
	});
}

const zeitFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Verlauf: Link hinzugefügt / geändert / entfernt (mit Titel und Domain). */
export async function linkVerlauf(k: Kontext, auftragId: string): Promise<{ iso: string; zeile: { id: string; zeit: string; wer: string; titel: string; aenderungen: { feld: string; alt: string; neu: string }[] } }[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select a.id::text as id, a.zeit, a.aktion, a.vorher, a.nachher, b.name
		from app.aenderungen a left join app.benutzer b on b.id = a.benutzer_id
		where a.betrieb_id = ${k.betriebId} and a.tabelle = 'auftrag_links'
			and coalesce(a.nachher ->> 'auftrag_id', a.vorher ->> 'auftrag_id') = ${auftragId}
		order by a.id desc limit 50`);
	return z.map((a) => {
		const l = (a.nachher ?? a.vorher) as { titel: string; url: string; im_portal: boolean };
		const name = `„${l.titel}“ (${domainVon(l.url)})`;
		let titel = a.aktion === 'angelegt' ? `Link ${name} hinzugefügt` : a.aktion === 'geloescht' ? `Link ${name} entfernt` : `Link ${name} geändert`;
		if (a.aktion === 'geaendert' && a.vorher.im_portal !== a.nachher.im_portal && a.vorher.titel === a.nachher.titel && a.vorher.url === a.nachher.url) {
			titel = `Link ${name} ${a.nachher.im_portal ? 'im Kundenportal sichtbar' : 'im Kundenportal ausgeblendet'}`;
		}
		return { iso: new Date(a.zeit).toISOString(), zeile: { id: `al${a.id}`, zeit: zeitFormat.format(new Date(a.zeit)), wer: a.name ?? 'System', titel, aenderungen: [] } };
	});
}
