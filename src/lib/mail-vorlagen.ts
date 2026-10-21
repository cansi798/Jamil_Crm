/**
 * E-Mail-Vorlagen an einem Ort (Wunsch Jamil, Talk msg 2789) – ohne Datenbank, auch im Browser nutzbar.
 *
 * Jede Vorlage hat einen Zweck (wofür sie gedacht ist). Je Zweck gibt es eine Standard-Vorlage; überall, wo eine Mail
 * vorbereitet wird, ist sie vorausgewählt und kann gegen eine andere getauscht werden. Die früher fest eingebauten
 * Texte (Auftragsbestätigung, Terminbestätigung, Portal-Link, …) sind die Startfassungen der Standard-Vorlagen.
 */
import { BEISPIEL_WERTE } from './nachfassen';

export const MAIL_ZWECKE = ['allgemein', 'nachfassen_angebot', 'zahlungserinnerung', 'auftragsbestaetigung', 'buchungsbestaetigung', 'portal_link', 'bewertung'] as const;
export type MailZweck = (typeof MAIL_ZWECKE)[number];
export const istMailZweck = (w: unknown): w is MailZweck => typeof w === 'string' && (MAIL_ZWECKE as readonly string[]).includes(w);

export const ZWECK_NAMEN: Record<MailZweck, string> = {
	allgemein: 'Allgemein (Mail an Kunden)',
	nachfassen_angebot: 'Nachfassen Angebot',
	zahlungserinnerung: 'Zahlungserinnerung / Mahnung',
	auftragsbestaetigung: 'Auftragsbestätigung',
	buchungsbestaetigung: 'Terminbestätigung (Online-Buchung)',
	portal_link: 'Kundenportal-Link',
	bewertung: 'Bewertungsanfrage'
};

/** Wo die Vorlage benutzt wird (Hinweis im Editor). */
export const ZWECK_HINWEIS: Record<MailZweck, string> = {
	allgemein: '„Mail an Kunden“ am Kunden, Auftrag und Angebot.',
	nachfassen_angebot: 'Nachfass-Stufen für Angebote (Einstellungen → Nachfassen).',
	zahlungserinnerung: 'Nachfass-Stufen für Rechnungen (sobald es Rechnungen gibt).',
	auftragsbestaetigung: 'Mail zur Auftragsbestätigung nach Annahme eines Angebots.',
	buchungsbestaetigung: 'Bestätigung nach einer Online-Buchung (je Terminart wählbar).',
	portal_link: '„Per E-Mail senden“ beim Kundenportal-Link des Kunden.',
	bewertung: '„Mail an Kunden“ – z. B. nach der Abnahme um eine Bewertung bitten.'
};

/** Beschreibung aller Platzhalter. */
export const PLATZHALTER_TEXTE: Record<string, string> = {
	'kunde.name': 'Name des Kunden (Firma bzw. Vor- und Nachname)',
	'kunde.anrede': 'Briefanrede, z. B. „Sehr geehrter Herr Müller“',
	'kunde.email': 'E-Mail des Kunden',
	'auftrag.titel': 'Titel des Auftrags',
	'auftrag.nummer': 'Auftragsnummer',
	'angebot.nummer': 'Angebotsnummer',
	'angebot.datum': 'Angebotsdatum',
	'angebot.gueltig_bis': 'Angebot gültig bis',
	betrag: 'Betrag brutto',
	faellig_am: 'Fällig am (Angebot: gültig bis)',
	tage: 'Tage seit dem Versand',
	'ab.nummer': 'Nummer der Auftragsbestätigung',
	termin: 'Termin, z. B. „Di, 21.10. um 9:00 Uhr“',
	dienst: 'Name der gebuchten Terminart',
	'buchung.link': 'Link zum Absagen/Verschieben des Termins',
	'portal.link': 'Link zum Kundenportal',
	'bewertung.link': 'Link zur Bewertungsseite (Einstellungen → Firmenprofil: Website)',
	link: 'Link (Website des Betriebs)',
	'firma.name': 'Name des Betriebs',
	'firma.telefon': 'Telefon des Betriebs',
	'firma.email': 'E-Mail des Betriebs',
	signatur: 'Firmensignatur (sonst automatisch am Ende)'
};

const GEMEINSAM = ['kunde.name', 'kunde.anrede', 'kunde.email', 'auftrag.titel', 'auftrag.nummer', 'link', 'firma.name', 'firma.telefon', 'firma.email', 'signatur'];
const ANGEBOT = ['angebot.nummer', 'angebot.datum', 'angebot.gueltig_bis', 'betrag'];

/** Erlaubte Platzhalter je Zweck (andere werden im Editor als unbekannt markiert). */
export const PLATZHALTER_JE_ZWECK: Record<MailZweck, readonly string[]> = {
	allgemein: [...GEMEINSAM, ...ANGEBOT],
	nachfassen_angebot: [...GEMEINSAM, ...ANGEBOT, 'faellig_am', 'tage'],
	zahlungserinnerung: [...GEMEINSAM, ...ANGEBOT, 'faellig_am', 'tage'],
	auftragsbestaetigung: [...GEMEINSAM, ...ANGEBOT, 'ab.nummer'],
	buchungsbestaetigung: [...GEMEINSAM, 'termin', 'dienst', 'buchung.link'],
	portal_link: [...GEMEINSAM, 'portal.link'],
	bewertung: [...GEMEINSAM, 'bewertung.link']
};

/** Alle {{platzhalter}} eines Textes (klein geschrieben, ohne Doppelte). */
export function platzhalterIn(text: string): string[] {
	return [...new Set([...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1].toLowerCase()))];
}

/** Platzhalter, die es für den Zweck nicht gibt (würden in der Mail leer bleiben). */
export function unbekanntePlatzhalter(texte: readonly (string | null | undefined)[], zweck: MailZweck): string[] {
	const erlaubt = new Set(PLATZHALTER_JE_ZWECK[zweck]);
	return [...new Set(texte.flatMap((t) => (t ? platzhalterIn(t) : [])))].filter((p) => !erlaubt.has(p));
}

/** Beispielwerte für die Vorschau (alle Platzhalter). */
export const BEISPIELE_ALLE: Record<string, string> = {
	...BEISPIEL_WERTE,
	'auftrag.nummer': 'A-2026-0042',
	'firma.email': 'info@example.org',
	'ab.nummer': 'AB-2026-0007',
	termin: 'Di, 27.10. um 9:00 Uhr',
	dienst: 'Besichtigung',
	'buchung.link': 'https://crm.example.org/buchung/…',
	'portal.link': 'https://crm.example.org/portal/…',
	'bewertung.link': 'https://www.example.org/bewertung'
};

export type StandardVorlage = { name: string; betreff: string; html: string };

const gruss = '<p>Mit freundlichen Grüßen</p>{{signatur}}';

/** Startfassungen der Standard-Vorlagen (vorher fest eingebaut). */
export const STANDARD_MAIL_VORLAGEN: Record<MailZweck, StandardVorlage> = {
	allgemein: {
		name: 'Kurze Nachricht an den Kunden',
		betreff: 'Ihr Auftrag {{auftrag.titel}}',
		html: `<p>{{kunde.anrede}},</p><p>…</p>${gruss}`
	},
	nachfassen_angebot: {
		name: 'Angebot – freundlich nachfragen',
		betreff: 'Ihr Angebot {{angebot.nummer}}',
		html:
			'<p>{{kunde.anrede}},</p><p>vor einigen Tagen haben wir Ihnen unser Angebot {{angebot.nummer}} über {{betrag}} geschickt. ' +
			`Haben Sie noch Fragen dazu? Wir beraten Sie gern – rufen Sie uns einfach an oder antworten Sie auf diese Mail.</p>${gruss}`
	},
	zahlungserinnerung: {
		name: 'Zahlungserinnerung – freundlich',
		betreff: 'Zahlungserinnerung',
		html:
			'<p>{{kunde.anrede}},</p><p>sicher ist es Ihrer Aufmerksamkeit entgangen: Der Betrag von {{betrag}} war am {{faellig_am}} fällig. ' +
			`Bitte überweisen Sie ihn in den nächsten Tagen. Falls Sie schon gezahlt haben, betrachten Sie diese Mail bitte als gegenstandslos.</p>${gruss}`
	},
	auftragsbestaetigung: {
		name: 'Auftragsbestätigung',
		betreff: 'Auftragsbestätigung {{ab.nummer}} – {{auftrag.titel}}',
		html: `<p>{{kunde.anrede}},</p><p>vielen Dank für Ihren Auftrag. Anbei erhalten Sie unsere Auftragsbestätigung {{ab.nummer}} zu unserem Angebot {{angebot.nummer}}.</p>${gruss}`
	},
	buchungsbestaetigung: {
		name: 'Terminbestätigung',
		betreff: 'Terminbestätigung: {{dienst}} am {{termin}}',
		html: `<p>{{kunde.anrede}},</p><p>Ihr Termin „{{dienst}}“ bei {{firma.name}} ist gebucht: {{termin}}.</p><p>Termin absagen oder verschieben: <a href="{{buchung.link}}">{{buchung.link}}</a></p>${gruss}`
	},
	portal_link: {
		name: 'Link zum Kundenportal',
		betreff: 'Ihr Kundenportal bei {{firma.name}}',
		html:
			'<p>{{kunde.anrede}},</p><p>über diesen persönlichen Link sehen Sie jederzeit den Stand Ihres Auftrags, Termine und Dokumente – und können Angebote direkt annehmen:</p>' +
			`<p><a href="{{portal.link}}">{{portal.link}}</a></p><p>Bitte geben Sie den Link nicht weiter.</p>${gruss}`
	},
	bewertung: {
		name: 'Bitte um Bewertung',
		betreff: 'Wie zufrieden waren Sie?',
		html:
			'<p>{{kunde.anrede}},</p><p>vielen Dank, dass Sie uns mit „{{auftrag.titel}}“ beauftragt haben. Wir würden uns sehr über eine kurze Bewertung freuen:</p>' +
			`<p><a href="{{bewertung.link}}">{{bewertung.link}}</a></p>${gruss}`
	}
};

/** Briefanrede aus Kundendaten (wie beim Nachfassen). */
export function briefAnrede(k: { art?: string | null; anrede?: string | null; vorname?: string | null; nachname?: string | null; einmalName?: string | null }): string {
	if (k.art === 'firma') return 'Sehr geehrte Damen und Herren';
	const nach = k.nachname ?? '';
	if (k.anrede === 'Herr' && nach) return `Sehr geehrter Herr ${nach}`;
	if (k.anrede === 'Frau' && nach) return `Sehr geehrte Frau ${nach}`;
	const name = [k.vorname, nach].filter(Boolean).join(' ') || k.einmalName || '';
	return name ? `Guten Tag ${name}` : 'Guten Tag';
}
