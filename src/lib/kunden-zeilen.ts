/**
 * Infos in der Zeile der Kundenliste (Jamil, Talk msg 3522) – Typen und Abzeichen ohne Serverbezug. Kurz: Zeichen + wenig Text,
 * Einzelheiten im Tooltip (`titel`). Gleiche Abzeichen-Optik wie auf den Auftragskarten (`ah-chip`).
 */
import { tagKurz } from './zeit';
import type { Abzeichen } from './auftrag-hinweise';

export type KundenZeilenRechte = {
	/** offene Aufträge, nächster Termin, Bestandskunde: Modul Aufträge + „Alle Aufträge ansehen“ */
	auftraege: boolean;
	/** letztes Angebot (ohne Betrag): Modul Angebote + „Alle Aufträge ansehen“ */
	angebote: boolean;
	/** Kundenportal: Modul Kundenportal + „Kundenportal verwalten“ + „Alle Aufträge ansehen“ (wie in der Kundenakte) */
	portal: boolean;
};

export type KundenZeilenInfo = {
	auftraege: { offen: number; bestandskunde: boolean; naechsterTermin: string | null } | null;
	angebot: { status: 'versendet' | 'angenommen' | 'abgelehnt'; tag: string; abgelaufen: boolean } | null;
	/** darf der Nutzer Angebotsinfos sehen? (dann erscheint auch „Kein Angebot“) */
	angebotSichtbar?: boolean;
	portal: { gueltig: boolean; jeEinLink: boolean; passwort: boolean; zugriffe: number; zuletzt: string | null } | null;
};

/** Sortierung der Kundenliste (`?sortierung=`): Name ist Standard; die anderen nur mit dem passenden Recht. */
export const KUNDEN_SORTIERUNGEN = [
	{ wert: 'name', text: 'Name', recht: null },
	{ wert: 'termin', text: 'Nächster Termin', recht: 'auftraege' },
	{ wert: 'angebot', text: 'Letztes Angebot', recht: 'angebote' },
	{ wert: 'portal', text: 'Portal zuletzt geöffnet', recht: 'portal' }
] as const;
export type KundenSortierung = (typeof KUNDEN_SORTIERUNGEN)[number]['wert'];

export function erlaubteSortierungen(r: KundenZeilenRechte) {
	return KUNDEN_SORTIERUNGEN.filter((s) => s.recht === null || r[s.recht]);
}
export function sortierungAus(w: unknown, r: KundenZeilenRechte): KundenSortierung {
	return erlaubteSortierungen(r).find((s) => s.wert === w)?.wert ?? 'name';
}

const kurz = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
const datumZeit = (iso: string) =>
	new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const berlinTagVon = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso));

/** `leer` = dezenter Leerzustand (grau, gestrichelt) – Jamil msg 3557 */
export type KundenAbzeichen = Omit<Abzeichen, 'ton'> & { ton: Abzeichen['ton'] | 'leer'; zeichen: string; art: 'angebot' | 'portal' | 'auftraege' | 'termin' | 'bestand' };

/**
 * Abzeichen einer Kundenzeile in fester Reihenfolge: Angebot · Portal · offene Aufträge · Termin · Bestandskunde.
 * Jamil msg 3557: auch der „leere“ Zustand steht da (grau: „Kein Angebot“, „Portal nicht aktiv“, „Keine offenen Aufträge“,
 * „Kein Termin“), damit alle Zeilen gleich aufgebaut und vergleichbar sind – soweit der Nutzer die Info sehen darf.
 * „Bestandskunde“ ist ein Merkmal, kein Zustand, und erscheint nur, wenn es zutrifft.
 */
export function kundenAbzeichen(i: KundenZeilenInfo | undefined | null): KundenAbzeichen[] {
	if (!i) return [];
	const l: KundenAbzeichen[] = [];
	const a = i.angebot;
	if (i.angebotSichtbar && !a) l.push({ art: 'angebot', zeichen: '–', ton: 'leer', text: 'Kein Angebot', titel: 'Noch kein Angebot verschickt' });
	if (a) {
		if (a.status === 'angenommen') l.push({ art: 'angebot', zeichen: '✓', ton: 'gut', text: `Angebot angenommen ${kurz(a.tag)}`, titel: `Letztes Angebot am ${kurz(a.tag)} angenommen` });
		else if (a.status === 'abgelehnt') l.push({ art: 'angebot', zeichen: '✕', ton: 'leise', text: `Angebot abgelehnt ${kurz(a.tag)}`, titel: `Letztes Angebot am ${kurz(a.tag)} abgelehnt` });
		else if (a.abgelaufen) l.push({ art: 'angebot', zeichen: '⌛', ton: 'warnung', text: 'Angebot abgelaufen', titel: `Letztes Angebot (verschickt ${kurz(a.tag)}) ist abgelaufen, ohne Antwort` });
		else l.push({ art: 'angebot', zeichen: '✉', ton: 'neutral', text: `Angebot offen seit ${kurz(a.tag)}`, titel: `Letztes Angebot am ${kurz(a.tag)} verschickt, noch keine Antwort` });
	}
	const p = i.portal;
	if (p && !p.gueltig && !p.jeEinLink) l.push({ art: 'portal', zeichen: '○', ton: 'leer', text: 'Portal nicht aktiv', titel: 'Für diesen Kunden wurde noch kein Portal-Link erzeugt' });
	if (p && (p.gueltig || p.jeEinLink)) {
		const geoeffnet = p.zugriffe > 0 ? `${p.zugriffe}× geöffnet${p.zuletzt ? `, zuletzt ${datumZeit(p.zuletzt)}` : ''}` : 'noch nie geöffnet';
		if (!p.gueltig) l.push({ art: 'portal', zeichen: '○', ton: 'leise', text: 'Portal aus', titel: `Kein gültiger Portal-Link (widerrufen oder abgelaufen) · ${geoeffnet}` });
		else if (!p.passwort) l.push({ art: 'portal', zeichen: '!', ton: 'warnung', text: 'Portal: Passwort fehlt', titel: `Link gültig, aber weder Postleitzahl noch eigenes Passwort – der Kunde kommt nicht hinein · ${geoeffnet}` });
		else l.push({ art: 'portal', zeichen: '●', ton: p.zugriffe > 0 ? 'gut' : 'neutral', text: `Portal aktiv · ${p.zugriffe}×`, titel: `Kundenportal aktiv · ${geoeffnet}` });
	}
	const au = i.auftraege;
	if (au) {
		if (au.offen > 0) l.push({ art: 'auftraege', zeichen: '▣', ton: 'neutral', text: `${au.offen} ${au.offen === 1 ? 'offener Auftrag' : 'offene Aufträge'}`, titel: 'Aufträge, die noch nicht abgerechnet sind' });
		else l.push({ art: 'auftraege', zeichen: '▢', ton: 'leer', text: 'Keine offenen Aufträge', titel: 'Alle Aufträge sind abgerechnet – oder es gibt noch keinen' });
		if (au.naechsterTermin) {
			const t = berlinTagVon(au.naechsterTermin);
			l.push({ art: 'termin', zeichen: '◷', ton: 'neutral', text: `Termin ${tagKurz(t)}`, titel: `Nächster Termin: ${datumZeit(au.naechsterTermin)}` });
		} else l.push({ art: 'termin', zeichen: '◷', ton: 'leer', text: 'Kein Termin', titel: 'Kein kommender Termin eingeplant' });
		if (au.bestandskunde) l.push({ art: 'bestand', zeichen: '★', ton: 'leise', text: 'Bestandskunde', titel: 'Mindestens ein Auftrag ist abgerechnet (Projekt erfolgreich beendet)' });
	}
	return l;
}
