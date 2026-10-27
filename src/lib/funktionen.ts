/**
 * Funktionen & Automatisierungen (Jamil, Talk msg 3423): alle automatischen Funktionen des CRM an EINEM Ort, geordnet
 * nach dem Weg des Kunden – Anfrage → Angebot → Auftrag → Abschluss → danach. Reines Wissen ohne Serverbezug; den
 * Zustand (an/aus, Zahlen) liefert `server/funktionen.ts`. Neue automatische Funktion → hier eintragen
 * (`tests/unit/funktionen.test.ts` prüft Pflichtfelder, eindeutige Schlüssel und dass Link-Ziele im Menü existieren).
 */
import type { Modul } from './tarife';

export type KundenSchritt = 'anfrage' | 'angebot' | 'auftrag' | 'abschluss' | 'danach';

export const SCHRITTE: { id: KundenSchritt; titel: string; frage: string }[] = [
	{ id: 'anfrage', titel: 'Anfrage', frage: 'Ein Interessent meldet sich' },
	{ id: 'angebot', titel: 'Angebot', frage: 'Sie schreiben und verschicken das Angebot' },
	{ id: 'auftrag', titel: 'Auftrag', frage: 'Das Angebot ist angenommen, die Arbeit läuft' },
	{ id: 'abschluss', titel: 'Abschluss', frage: 'Die Arbeit ist fertig, es wird abgerechnet' },
	{ id: 'danach', titel: 'Danach', frage: 'Der Kunde bleibt Kunde' }
];

/** Welcher Zustand gehört zur Funktion? `schalter`: genau ein Ein/Aus-Schalter, der hier direkt umgelegt werden kann. */
export type FunktionsZustand = 'ab_automatisch' | 'bestand_aktiv' | 'nachfassen' | 'buchung' | 'portal_links' | 'kunden_portal' | 'keiner';

export type Funktion = {
	id: string;
	schritt: KundenSchritt;
	name: string;
	/** Was passiert? Ein Satz in einfacher Sprache. */
	was: string;
	/** Wann löst es aus? */
	wann: string;
	/** Einstellung (Link) */
	href: string;
	/** Schlüssel des Info-Fensters (`einstellungs-infos.ts`) */
	info?: string;
	zustand: FunktionsZustand;
	/** direkt umschaltbar (nur bei `ab_automatisch`, `bestand_aktiv`) */
	schalter?: boolean;
	/** nur mit diesem Modul des Tarifs */
	modul?: Modul;
	/** nur mit diesem Recht */
	recht: string;
};

export const FUNKTIONEN: Funktion[] = [
	{
		id: 'quellen',
		schritt: 'anfrage',
		name: 'Auftragsquellen',
		was: 'Jeder neue Auftrag bekommt eine Herkunft (Website, Empfehlung …). Die Auswertung zeigt, welche Quelle am meisten bringt.',
		wann: 'Beim Anlegen eines Auftrags und bei Online-Buchungen.',
		href: '/einstellungen/quellen',
		info: 'quellen.seite',
		zustand: 'keiner',
		modul: 'auftraege',
		recht: 'einstellungen'
	},
	{
		id: 'online-buchung',
		schritt: 'anfrage',
		name: 'Online-Buchung',
		was: 'Interessenten buchen freie Termine selbst über einen Link oder Ihre Internetseite; der Termin landet in der Plantafel.',
		wann: 'Sobald jemand die Buchungsseite benutzt.',
		href: '/einstellungen/online-buchung',
		info: 'buchung.seite',
		zustand: 'buchung',
		modul: 'plantafel',
		recht: 'buchung.verwalten'
	},
	{
		id: 'nachfassen-angebot',
		schritt: 'angebot',
		name: 'Nachfassen bei Angeboten',
		was: 'Bleibt ein Angebot unbeantwortet, legt das CRM eine Aufgabe an und bereitet eine Mail vor. Es wird nichts ohne Ihr Zutun versendet.',
		wann: 'Nach der eingestellten Zahl von Tagen seit dem Versand; stoppt bei Annahme oder Ablehnung.',
		href: '/einstellungen/nachfassen',
		info: 'nachfassen.seite',
		zustand: 'nachfassen',
		modul: 'angebote',
		recht: 'einstellungen'
	},
	{
		id: 'online-annahme',
		schritt: 'angebot',
		name: 'Angebot online annehmen',
		was: 'Der Kunde nimmt das Angebot im Kundenportal an oder lehnt es ab – mit Bestätigung der AGB und Nachweis.',
		wann: 'Wenn der Kunde sein Portal öffnet und ein Angebot offen ist.',
		href: '/einstellungen/kundenportal',
		info: 'portal.seite',
		zustand: 'portal_links',
		modul: 'kundenportal',
		recht: 'einstellungen'
	},
	{
		id: 'ab-automatisch',
		schritt: 'auftrag',
		name: 'Auftragsbestätigung automatisch',
		was: 'Nach der Annahme eines Angebots entsteht die Auftragsbestätigung als PDF am Auftrag und im Portal.',
		wann: 'Sobald ein Angebot angenommen ist (Portal, Büro oder Sprache).',
		href: '/einstellungen/kundenportal',
		info: 'portal.ab_automatisch',
		zustand: 'ab_automatisch',
		schalter: true,
		modul: 'angebote',
		recht: 'einstellungen'
	},
	{
		id: 'kundenportal',
		schritt: 'auftrag',
		name: 'Kundenportal',
		was: 'Kunden sehen ihren Auftrag: Status, Termine, Unterlagen und Ansprechpartner – passend zu Ihrer Internetseite.',
		wann: 'Sobald beim Kunden ein Portal-Link erzeugt ist.',
		href: '/einstellungen/kundenportal',
		info: 'portal.seite',
		zustand: 'portal_links',
		modul: 'kundenportal',
		recht: 'einstellungen'
	},
	{
		id: 'portal-je-kunde',
		schritt: 'auftrag',
		name: 'Portal-Einstellungen je Kunde',
		was: 'Was ein Kunde im Portal sieht und ob für ihn die Auftragsbestätigung automatisch entsteht, stellen Sie beim Kunden ein. Leer heißt: Standard der Firma.',
		wann: 'Immer, wenn der Kunde sein Portal öffnet oder ein Angebot annimmt.',
		href: '/kunden',
		info: 'kunde.portal_seite',
		zustand: 'kunden_portal',
		modul: 'kundenportal',
		recht: 'kundenportal.verwalten'
	},
	{
		id: 'erinnerungen',
		schritt: 'auftrag',
		name: 'Erinnerungen',
		was: 'Das CRM erinnert an Einsätze und Aufgaben – in der Glocke und auf Wunsch als Mitteilung auf dem Handy.',
		wann: 'Vor dem Einsatz bzw. zur Fälligkeit der Aufgabe.',
		href: '/konto/benachrichtigungen',
		info: 'benachrichtigungen.seite',
		zustand: 'keiner',
		recht: 'erinnerungen.nutzen'
	},
	{
		id: 'handy-abgleich',
		schritt: 'auftrag',
		name: 'Aufgaben aufs Handy',
		was: 'Ihre Aufgaben erscheinen in der Erinnerungen-App am Handy und kommen von dort zurück.',
		wann: 'Laufend, sobald ein Gerät verbunden ist.',
		href: '/konto/handy',
		info: 'handy.seite',
		zustand: 'keiner',
		modul: 'auftraege',
		recht: 'auftraege.lesen'
	},
	{
		id: 'mail-vorlagen',
		schritt: 'auftrag',
		name: 'E-Mail-Vorlagen mit Standard',
		was: 'Überall, wo das CRM eine Mail vorbereitet, ist die Standard-Vorlage vorausgewählt und die Signatur steht darunter.',
		wann: 'Bei jeder vorbereiteten Mail (Angebot, Portal-Link, Nachfassen).',
		href: '/einstellungen/mail-vorlagen',
		info: 'mail-vorlagen.seite',
		zustand: 'keiner',
		recht: 'vorlagen.verwalten'
	},
	{
		id: 'nachfassen-rechnung',
		schritt: 'abschluss',
		name: 'Zahlungserinnerung',
		was: 'Bleibt eine Rechnung unbezahlt, legt das CRM eine Aufgabe an und bereitet Zahlungserinnerung bzw. Mahnung vor. (Rechnungen kommen mit der Lexware-Anbindung.)',
		wann: 'Nach der eingestellten Zahl von Tagen seit Rechnungsdatum.',
		href: '/einstellungen/nachfassen',
		info: 'nachfassen.seite',
		zustand: 'nachfassen',
		modul: 'angebote',
		recht: 'einstellungen'
	},
	{
		id: 'bestandskarte',
		schritt: 'danach',
		name: 'Leistungen für Bestandskunden',
		was: 'Kunden mit abgeschlossenem Auftrag sehen im Portal eine dezente Karte mit Ihren Leistungen und Knöpfen.',
		wann: 'Sobald ein Auftrag des Kunden „Projekt erfolgreich beendet“ ist.',
		href: '/einstellungen/bestandskunden',
		info: 'bestand.seite',
		zustand: 'bestand_aktiv',
		schalter: true,
		modul: 'kundenportal',
		recht: 'einstellungen'
	}
];

export type FunktionenNutzer = { rechte: readonly string[] };

/** Funktionen, die dieser Nutzer sehen darf (Recht) und die der Tarif enthält (Modul). */
export function sichtbareFunktionen(nutzer: FunktionenNutzer, module: readonly string[]): Funktion[] {
	return FUNKTIONEN.filter((f) => nutzer.rechte.includes(f.recht) && (!f.modul || module.includes(f.modul)));
}

/** Nach dem Kundenweg gruppiert; Schritte ohne Funktion entfallen. */
export function nachSchritt(liste: readonly Funktion[]): { schritt: (typeof SCHRITTE)[number]; funktionen: Funktion[] }[] {
	return SCHRITTE.map((schritt) => ({ schritt, funktionen: liste.filter((f) => f.schritt === schritt.id) })).filter((g) => g.funktionen.length > 0);
}
