/**
 * „Was ist neu“ (Jamil, Talk msg 3423): ein Satz pro neuer Funktion – und wo man sie findet. Neueste zuerst.
 * Bei JEDER neuen Funktion hier einen Eintrag ergänzen (Regel in CLAUDE.md). `modul`/`recht` blenden Einträge aus, die der
 * Nutzer ohnehin nicht öffnen könnte.
 */
import type { Modul } from './tarife';

export type Neuigkeit = {
	/** JJJJ-MM-TT */
	datum: string;
	titel: string;
	/** ein Satz in einfacher Sprache */
	satz: string;
	/** Wo findet man es? Menüpfad in Worten */
	wo: string;
	href: string;
	modul?: Modul;
	recht?: string;
};

export const NEUIGKEITEN: Neuigkeit[] = [
	{ datum: '2026-10-28', titel: 'Mehr Infos in der Kundenliste', satz: 'Jede Kundenzeile zeigt jetzt kleine Abzeichen: letztes Angebot, Kundenportal (aktiv, wie oft geöffnet), offene Aufträge, nächster Termin und „Bestandskunde“; sortierbar nach Termin, Angebot oder Portal.', wo: 'Kunden', href: '/kunden' },
	{ datum: '2026-10-28', titel: 'Ausgangsbelege am Auftrag', satz: 'Rechts im Auftrag stehen Angebote und Auftragsbestätigungen (später auch Rechnungen) in einer Liste, mit Abzeichen für die Belegart.', wo: 'Auftrag → rechts „Ausgangsbelege“', href: '/auftraege', modul: 'angebote' },
	{ datum: '2026-10-28', titel: 'Unteraufgaben und Personen direkt auf der Karte', satz: 'Aufgaben haben jetzt Unteraufgaben zum Abhaken; die zugewiesenen Personen ändern Sie direkt auf der Karte. Lautstärke und Schmutz gibt es nur noch bei Aufgaben im Auftrag.', wo: 'Aufgaben → Karte → Bearbeiten', href: '/todos', modul: 'auftraege' },
	{ datum: '2026-10-28', titel: 'Kundenportal feiner einstellbar', satz: 'Die Karte für Bestandskunden erscheint ab einem wählbaren Auftragsstatus oder immer und lässt sich je Kunde abschalten; auf Wunsch verschwindet ohne Mitarbeiternamen auch der Projektbegleiter.', wo: 'Auftrag → Kundenportal & Auftragsbestätigung (Abschnitt „Leistungen für Bestandskunden“); Kundenakte → Kundenportal', href: '/einstellungen/kundenportal', modul: 'kundenportal', recht: 'einstellungen' },
	{ datum: '2026-10-28', titel: 'Automatik beim Kunden', satz: '„Auftragsbestätigung automatisch“ stellen Sie in der Kundenakte im neuen Abschnitt „Automatik“ ein – auch ohne Kundenportal; dort steht jetzt auch „Kein automatisches Nachfassen“.', wo: 'Kundenakte → Automatik', href: '/kunden', modul: 'angebote', recht: 'auftraege.bearbeiten' },
	{ datum: '2026-10-27', titel: 'Portal-Einstellungen beim Kunden', satz: 'Was ein Kunde im Portal sieht und ob für ihn die Auftragsbestätigung automatisch entsteht, stellen Sie jetzt beim Kunden ein (leer = Standard der Firma); beim Auftrag steht dafür nur noch ein Hinweis mit Link. Einzelne Dokumente geben Sie weiter beim Auftrag frei.', wo: 'Kunde → Kundenportal → Einstellungen für diesen Kunden', href: '/kunden', modul: 'kundenportal', recht: 'kundenportal.verwalten' },
	{ datum: '2026-10-27', titel: 'Menü nach dem Weg des Kunden', satz: 'Die Einstellungen sind jetzt nach Anfrage, Angebot, Auftrag, Abschluss und Danach geordnet statt nach Themen.', wo: 'Menü links', href: '/einstellungen/funktionen', recht: 'einstellungen' },
	{ datum: '2026-10-27', titel: 'Funktionen & Automatisierungen', satz: 'Eine Übersicht aller automatischen Funktionen mit Erklärung, Auslöser und – wo es einen einzelnen Schalter gibt – Ein/Aus.', wo: 'Menü → Allgemein → Funktionen & Automatisierungen', href: '/einstellungen/funktionen', recht: 'einstellungen' },
	{ datum: '2026-10-27', titel: 'Info-Fenster bei den Einstellungen', satz: 'Das kleine ⓘ erklärt bei jeder Einstellung, was sie verändert, auf wen sie wirkt, wie sie ab Werk steht und gibt ein Beispiel.', wo: 'bei allen Einstellungen', href: '/einstellungen/kundenportal', recht: 'einstellungen' },
	{ datum: '2026-10-27', titel: 'Leistungen für Bestandskunden', satz: 'Eine dezente Karte im Kundenportal nach Abschluss eines Auftrags – mit eigener Überschrift, eigenen Leistungen und Knöpfen.', wo: 'Menü → Auftrag → Kundenportal & Auftragsbestätigung → Leistungen für Bestandskunden', href: '/einstellungen/kundenportal', modul: 'kundenportal', recht: 'einstellungen' },
	{ datum: '2026-10-27', titel: '„+ Termin“ oben rechts', satz: 'Neue Termine legen Sie in der Plantafel jetzt mit dem Knopf oben rechts an.', wo: 'Plantafel, oben rechts', href: '/plantafel', modul: 'plantafel', recht: 'plantafel.bearbeiten' },
	{ datum: '2026-10-22', titel: 'Terminarten', satz: 'Eine Liste für Plantafel und Online-Buchung mit Farbe, Dauer und „online buchbar“.', wo: 'Menü → Anfrage → Terminarten', href: '/einstellungen/terminarten', modul: 'plantafel', recht: 'buchung.verwalten' },
	{ datum: '2026-10-22', titel: 'Schnellzugriff', satz: 'Der runde Knopf unten rechts öffnet Sprachsteuerung, Neuer Kunde, Neuer Auftrag, Neuer Termin und Neue Aufgabe.', wo: 'Unten rechts auf jeder Seite', href: '/' },
	{ datum: '2026-10-22', titel: 'Kundenportal mit Passwort', satz: 'Das Portal öffnet sich mit der Postleitzahl des Kunden oder einem eigenen Passwort; den Link können Sie wieder öffnen und kopieren.', wo: 'Beim Kunden → Kundenportal', href: '/kunden', modul: 'kundenportal' },
	{ datum: '2026-10-22', titel: 'Portal: Figuren und Fortschrittsweg', satz: 'Der Kunde sieht seinen Projektbegleiter als Figur, den Fortschritt als Weg und zu jedem Status eine kurze Erklärung.', wo: 'Im Kundenportal', href: '/kunden', modul: 'kundenportal' },
	{ datum: '2026-10-22', titel: 'AGB als PDF', satz: 'Die AGB werden hochgeladen, der Kunde bestätigt sie beim Annehmen, und die Fassung wird als Nachweis festgehalten.', wo: 'Menü → Auftrag → Kundenportal & Auftragsbestätigung', href: '/einstellungen/kundenportal', modul: 'angebote', recht: 'einstellungen' },
	{ datum: '2026-10-21', titel: 'Aufgaben aufs Handy', satz: 'Ihre Aufgaben erscheinen in der Erinnerungen-App und kommen von dort zurück ins CRM.', wo: 'Menü → Allgemein → Handy verbinden', href: '/konto/handy', modul: 'auftraege' }
];

export type NeuNutzer = { rechte: readonly string[] };

export function sichtbareNeuigkeiten(nutzer: NeuNutzer, module: readonly string[]): Neuigkeit[] {
	return NEUIGKEITEN.filter((n) => (!n.recht || nutzer.rechte.includes(n.recht)) && (!n.modul || module.includes(n.modul)));
}
