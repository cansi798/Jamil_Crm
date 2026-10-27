/**
 * Info-Texte zu den Einstellungen (Jamil, Talk msg 3423): Hinter jeder Einstellung steht ein kleines ⓘ
 * (`components/ui/InfoFenster.svelte`), das in einfachen Worten erklärt, was die Einstellung verändert.
 * EIN Ort für alle Texte – die Seiten nennen nur den Schlüssel (`<InfoFenster id="portal.ab_automatisch" />`).
 * Aufbau je Eintrag: Was sie verändert · Wirkt auf · Standard · Beispiel. Neue Einstellung → hier ergänzen
 * (`tests/unit/einstellungs-infos.test.ts` prüft, dass jeder benutzte Schlüssel einen vollständigen Text hat).
 */
export type Info = {
	/** Kurzer Name der Einstellung (Überschrift des Fensters) */
	titel: string;
	/** Was ändert sich, wenn man sie umstellt? */
	was: string;
	/** Auf wen oder was wirkt sie (Firma, Kunde, Auftrag, Mitarbeiter)? */
	wirkt: string;
	/** Wie ist sie ab Werk eingestellt? */
	standard: string;
	/** Ein Beispiel aus dem Alltag */
	beispiel: string;
};

export const INFOS: Record<string, Info> = {
	// ——— Kundenportal & Auftragsbestätigung ———
	'portal.seite': {
		titel: 'Kundenportal & Auftragsbestätigung',
		was: 'Legt fest, was Ihre Kunden im Kundenportal sehen und was nach der Annahme eines Angebots automatisch geschieht.',
		wirkt: 'Alle Kunden Ihrer Firma. Einzelne Kunden und Aufträge können davon abweichen.',
		standard: 'Portal zeigt alle aktiven Aufträge, Namen als Vorname, Auftragsbestätigung entsteht automatisch.',
		beispiel: 'Ein Kunde öffnet seinen Link und sieht Status, Termine und Unterlagen seines Auftrags.'
	},
	'portal.agb_pdf': {
		titel: 'Allgemeine Geschäftsbedingungen (PDF)',
		was: 'Das hochgeladene PDF erscheint im Portal als Link beim Annehmen eines Angebots und unter „Ihre Unterlagen“.',
		wirkt: 'Alle Kunden. Bei jeder Annahme wird festgehalten, welche Fassung der Kunde bestätigt hat.',
		standard: 'Keine AGB hinterlegt – dann gelten sie bei neuen Annahmen nicht als wirksam einbezogen.',
		beispiel: 'Sie laden die neue Fassung hoch; ab dann bestätigen Kunden diese Fassung. Alte Annahmen behalten ihren Nachweis.'
	},
	'portal.ab_automatisch': {
		titel: 'Auftragsbestätigung automatisch erstellen',
		was: 'Sobald ein Angebot angenommen ist, entsteht ohne Handarbeit die Auftragsbestätigung als PDF am Auftrag.',
		wirkt: 'Alle neuen Annahmen (Portal, Büro oder Sprache). Je Auftrag lässt sich das abschalten.',
		standard: 'An.',
		beispiel: 'Der Kunde nimmt das Angebot online an – die Auftragsbestätigung liegt kurz danach im Auftrag und im Portal bereit.'
	},
	'portal.standard': {
		titel: 'Welche Aufträge stehen im Portal?',
		was: '„Alle aktiven“ zeigt jedem Kunden alle seine Aufträge, die noch nicht abgerechnet sind. „Nur markierte“ zeigt nur Aufträge, bei denen „Im Portal zeigen: ja“ steht.',
		wirkt: 'Alle Kunden; je Auftrag überschreibbar.',
		standard: 'Alle aktiven Aufträge.',
		beispiel: 'Mit „nur markierte“ sieht der Kunde einen neuen Auftrag erst, wenn Sie ihn bewusst freigeben.'
	},
	'portal.team_namen': {
		titel: 'Namen von Ansprechpartner und Team',
		was: 'Bestimmt, ob der Kunde im Portal nur Vornamen, volle Namen oder gar keine Namen Ihrer Mitarbeiter sieht.',
		wirkt: 'Alle Kunden im Portal (Ansprechpartner, Team, Termine). Je Auftrag abschaltbar.',
		standard: 'Nur Vorname.',
		beispiel: '„Sabine“ statt „Sabine Schäfer“ – weniger Daten nach außen.'
	},
	'portal.agb_url': {
		titel: 'Link zu den AGB',
		was: 'Verweist im Portal auf eine Internetseite mit Ihren AGB. Gilt nur, wenn kein AGB-PDF hinterlegt ist.',
		wirkt: 'Alle Kunden beim Annehmen eines Angebots.',
		standard: 'Leer.',
		beispiel: 'https://www.ihre-firma.de/agb'
	},
	'portal.widerruf_url': {
		titel: 'Link zur Widerrufsbelehrung',
		was: 'Zeigt im Portal einen Link zu Ihrer Widerrufsbelehrung.',
		wirkt: 'Alle Kunden beim Annehmen eines Angebots.',
		standard: 'Leer (kein Link).',
		beispiel: 'https://www.ihre-firma.de/widerruf'
	},
	'portal.erscheinungsbild': {
		titel: 'Erscheinungsbild des Kundenportals',
		was: 'Farben und Schriften des Portals, damit es wie Ihre Internetseite aussieht.',
		wirkt: 'Das Kundenportal aller Kunden (und die Vorschau in den Einstellungen).',
		standard: 'Anthrazit-Kopf, helle Seite, Schrift Montserrat/Inter.',
		beispiel: 'Dunkelblauer Kopf und Ihre Hausfarbe als Akzent.'
	},

	// ——— Leistungen für Bestandskunden ———
	'bestand.seite': {
		titel: 'Leistungen für Bestandskunden',
		was: 'Eine kleine Karte am Ende des Kundenportals mit Ihren Leistungen für die Zeit nach dem Auftrag.',
		wirkt: 'Kunden mit mindestens einem abgeschlossenen Auftrag („Projekt erfolgreich beendet“).',
		standard: 'An, mit sechs Beispiel-Leistungen und ohne Knöpfe.',
		beispiel: 'Nach der Badsanierung sieht der Kunde „Hausmeisterservice“ und den Knopf „Termin anfragen“.'
	},
	'bestand.aktiv': {
		titel: 'Karte im Kundenportal anzeigen',
		was: 'Schaltet die Karte im Portal ein oder aus.',
		wirkt: 'Alle Kunden mit abgeschlossenem Auftrag.',
		standard: 'An.',
		beispiel: 'Aus: Kunden sehen nach Abschluss nichts Zusätzliches.'
	},
	'bestand.titel': {
		titel: 'Überschrift der Karte',
		was: 'Die Überschrift über der Karte. Das letzte Wort wird in der Hausfarbe gezeigt.',
		wirkt: 'Karte im Portal aller Kunden mit abgeschlossenem Auftrag.',
		standard: 'Auch nach Abschluss für Sie da',
		beispiel: '„Wir bleiben für Sie da“ – ohne das Wort „Bestandskunde“.'
	},
	'bestand.text': {
		titel: 'Kleiner Text',
		was: 'Ein kurzer Satz unter der Überschrift (höchstens 240 Zeichen). Darf leer bleiben.',
		wirkt: 'Karte im Portal.',
		standard: 'Gerne unterstützen wir Sie auch künftig – sprechen Sie uns einfach an, wenn wir helfen können.',
		beispiel: 'Ob Wartung oder kleine Reparatur – melden Sie sich gerne.'
	},
	'bestand.leistungen': {
		titel: 'Leistungen',
		was: 'Die Leistungen, die Bestandskunden angeboten werden: Titel, kurzer Text und Symbol. Reihenfolge wie in der Liste.',
		wirkt: 'Karte im Portal (bis zu 10 Leistungen).',
		standard: 'Hausmeisterservice, Garten- und Grundstückspflege, Winterdienst, Kleinreparaturen, Altersgerechte Anpassungen, Individuelle Unterstützung.',
		beispiel: '„Heizungswartung – einmal im Jahr“.'
	},
	'bestand.knoepfe': {
		titel: 'Knöpfe mit Link',
		was: 'Knöpfe unter der Karte mit eigener Beschriftung und Adresse. Erlaubt sind https://, mailto: und tel:. Internetadressen öffnen in einem neuen Tab.',
		wirkt: 'Karte im Portal (bis zu 4 Knöpfe).',
		standard: 'Keine Knöpfe.',
		beispiel: '„Termin anfragen“ mit https://www.ihre-firma.de/anfrage oder „Anrufen“ mit tel:+4940123456.'
	},

	// ——— Nachfassen ———
	'nachfassen.seite': {
		titel: 'Automatisch nachfassen',
		was: 'Legt Stufen fest („nach N Tagen“), bei denen das CRM eine Aufgabe anlegt und/oder eine Mail vorbereitet, wenn ein Angebot oder eine Rechnung unbeantwortet bleibt.',
		wirkt: 'Alle Angebote und Rechnungen. Pro Angebot lässt sich pausieren, pro Kunde komplett abschalten („kein Nachfassen“).',
		standard: 'Stufen, wie sie unten stehen; es wird nichts ohne Ihr Zutun versendet.',
		beispiel: 'Nach 7 Tagen ohne Antwort erscheint die Aufgabe „Angebot nachfassen“ mit fertigem Mailtext.'
	},
	'nachfassen.stufe': {
		titel: 'Stufe aktiv',
		was: 'Schaltet diese eine Stufe ein oder aus. Ausgeschaltete Stufen lösen nichts mehr aus.',
		wirkt: 'Alle Angebote bzw. Rechnungen, die diese Stufe erreichen.',
		standard: 'An.',
		beispiel: 'Die Stufe „nach 14 Tagen“ ausschalten, wenn ein Anruf reicht.'
	},

	// ——— Online-Buchung, Terminarten, Quellen ———
	'buchung.seite': {
		titel: 'Online-Buchung',
		was: 'Kunden buchen freie Zeiten selbst über einen Link oder Ihre Internetseite. Buchbar sind die Terminarten mit „online buchbar“.',
		wirkt: 'Alle Besucher der Buchungsseite; gebucht wird in die Plantafel der gewählten Mitarbeiter.',
		standard: 'Ohne online buchbare Terminart passiert nichts.',
		beispiel: 'Ein Interessent bucht „Besichtigung, 60 Minuten“ am Donnerstag um 10 Uhr.'
	},
	'buchung.datenschutz': {
		titel: 'Datenschutz und Website',
		was: 'Link zur Datenschutzerklärung für die Zustimmung auf der Buchungsseite und Websites, auf denen die Buchung eingebettet werden darf.',
		wirkt: 'Buchungsseite und eingebettete Buchung.',
		standard: 'Leer – keine Einbettung auf fremden Seiten erlaubt.',
		beispiel: 'https://www.ihre-firma.de/datenschutz'
	},
	'buchung.zeiten': {
		titel: 'Arbeitszeiten für Buchungen',
		was: 'Zu welchen Zeiten Kunden Termine buchen können, mit Ausnahmen (Urlaub, Sondertage).',
		wirkt: 'Alle online buchbaren Terminarten – oder nur eine, wenn Sie eigene Zeiten festlegen.',
		standard: 'Wochenzeiten wie eingestellt; belegte Zeiten (Plantafel, Urlaub) sind automatisch gesperrt.',
		beispiel: 'Mo–Fr 8–16 Uhr, am Freitag nur bis 12 Uhr.'
	},
	'terminarten.seite': {
		titel: 'Terminarten',
		was: 'Die Arten von Terminen (Besichtigung, Wartung …) mit Farbe und Dauer. Eine Liste für Plantafel und Online-Buchung.',
		wirkt: 'Auswahl beim Einplanen in der Plantafel und auf der Buchungsseite.',
		standard: 'Wie angelegt; „online buchbar“ ist je Terminart einstellbar.',
		beispiel: '„Besichtigung, 60 Minuten, blau, online buchbar“.'
	},
	'quellen.seite': {
		titel: 'Auftragsquellen',
		was: 'Woher ein Auftrag kommt (Website, Empfehlung, Hornbach …). Erscheint am Auftrag und in der Auswertung.',
		wirkt: 'Aufträge und die Auswertung nach Auftragsquelle.',
		standard: 'Wie angelegt.',
		beispiel: 'Nach einem halben Jahr sehen Sie, welche Quelle die meisten angenommenen Angebote bringt.'
	},

	// ——— Firma, Kalkulation, Kennzahlen ———
	'briefkopf.seite': {
		titel: 'Briefkopf und Firmenprofil',
		was: 'Logo, Hausfarbe und Firmendaten. Sie erscheinen auf Angeboten, Auftragsbestätigungen, im Kundenportal und in der App.',
		wirkt: 'Alle Dokumente und Seiten Ihrer Firma nach außen.',
		standard: 'Gold als Hausfarbe, kein Logo.',
		beispiel: 'Mit Logo und IBAN im Fuß wirkt jedes Angebot vollständig.'
	},
	'briefkopf.hausfarbe': {
		titel: 'Hausfarbe',
		was: 'Die Farbe für Knöpfe und Markierungen in App und Kundenportal. Lesbare Schriftfarben werden automatisch gewählt.',
		wirkt: 'App und Kundenportal.',
		standard: 'Gold (#c3a56f).',
		beispiel: 'Ihr Firmenblau macht Knöpfe und Akzente blau.'
	},
	'kalkulation.seite': {
		titel: 'Kalkulation / Stundensatz',
		was: 'Aus Gehältern, Fixkosten, Wagnis und Gewinn entsteht Ihr Verrechnungs-Stundensatz.',
		wirkt: 'Angebote und Nachkalkulation. Nur für Chef sichtbar (vertraulich).',
		standard: 'Beispielwerte, bitte anpassen.',
		beispiel: 'Mehr Fixkosten pro Monat erhöhen den Stundensatz.'
	},
	'kennzahlen.seite': {
		titel: 'Kennzahlen einstellen',
		was: 'Welche Kennzahlen im Cockpit (Auswertungen) angezeigt werden.',
		wirkt: 'Das Kennzahlen-Cockpit für alle, die es sehen dürfen.',
		standard: 'Wichtige Kennzahlen sind an.',
		beispiel: 'Eine Kennzahl ausschalten, die Sie nicht brauchen, damit das Cockpit ruhiger wird.'
	},

	// ——— Vorlagen ———
	'mail-vorlagen.seite': {
		titel: 'E-Mail-Vorlagen und Signatur',
		was: 'Fertige Mailtexte (Angebot, Nachfassen, Portal-Link …) und die Signatur unter jeder Mail.',
		wirkt: 'Alle Mails, die aus dem CRM vorbereitet werden.',
		standard: 'Mitgelieferte Vorlagen; Signatur leer.',
		beispiel: 'Die Signatur mit Telefonnummer steht automatisch unter jeder Mail an Kunden.'
	},
	'protokoll-vorlagen.seite': {
		titel: 'Protokoll-Vorlagen',
		was: 'Baukasten für Formulare, die Mitarbeiter auf der Baustelle ausfüllen (Abnahme, Übergabe …).',
		wirkt: 'Neue Protokolle an Aufträgen.',
		standard: 'Mitgelieferte Beispiele.',
		beispiel: 'Abnahmeprotokoll mit Unterschrift des Kunden.'
	},
	'aufmass-vorlagen.seite': {
		titel: 'Aufmaß-Vorlagen',
		was: 'Vorlagen für das Aufmaß (Maße, Flächen) mit Formeln.',
		wirkt: 'Neue Aufmaße an Aufträgen.',
		standard: 'Mitgelieferte Beispiele.',
		beispiel: 'Raum mit Länge × Breite ergibt die Fläche.'
	},

	// ——— Benutzer, Rollen, Nextcloud, persönliches ———
	'rollen.seite': {
		titel: 'Rollen',
		was: 'Eine Rolle legt fest, was ein Benutzer sehen und tun darf.',
		wirkt: 'Alle Benutzer mit dieser Rolle.',
		standard: 'Chef, Büro und Monteur sind vorbereitet.',
		beispiel: 'Monteure sehen nur ihre Aufträge und keine Preise.'
	},
	'benutzer.seite': {
		titel: 'Benutzer',
		was: 'Wer Zugang zum CRM hat, mit welcher Rolle und Anrede.',
		wirkt: 'Anmeldung und Rechte der Benutzer; die Anrede bestimmt die Figur im Kundenportal.',
		standard: 'Neue Benutzer kommen per Einladung.',
		beispiel: 'Neue Mitarbeiterin einladen und die Rolle „Büro“ geben.'
	},
	'nextcloud.seite': {
		titel: 'Nextcloud-Anbindung',
		was: 'Verbindet das CRM mit Ihrer Nextcloud (Anmeldung, Kalender, Kontakte, Dateien).',
		wirkt: 'Verknüpfte Konten.',
		standard: 'Nur sichtbar, wenn der Server angebunden ist.',
		beispiel: 'Mitarbeiter melden sich mit dem Nextcloud-Konto an.'
	},
	'benachrichtigungen.seite': {
		titel: 'Benachrichtigungen (Erinnerungen)',
		was: 'Ob dieses Gerät Mitteilungen bekommt, z. B. Erinnerungen an Einsätze und Aufgaben.',
		wirkt: 'Nur Sie, nur dieses Gerät.',
		standard: 'Aus, bis Sie es erlauben.',
		beispiel: 'Handy meldet sich 30 Minuten vor dem Einsatz.'
	},
	'handy.seite': {
		titel: 'Handy verbinden',
		was: 'Zeigt Ihre Aufgaben im Handy (Kalender-/Aufgaben-App) über ein App-Passwort.',
		wirkt: 'Nur Sie; je Gerät ein eigenes Passwort.',
		standard: 'Nicht verbunden.',
		beispiel: 'Aufgaben erscheinen in „Erinnerungen“ auf dem iPhone.'
	},
	'handy.je_auftrag': {
		titel: 'Für jeden Auftrag eine eigene Liste',
		was: 'Aus: alle Aufgaben stehen in einer Liste. An: Aufgaben mit Auftrag bekommen je Auftrag eine Liste.',
		wirkt: 'Nur Ihre Handy-Listen.',
		standard: 'Aus.',
		beispiel: 'An: „Badsanierung Müller“ erscheint als eigene Liste.'
	},

	// ——— Funktionen & Automatisierungen ———
	'funktionen.seite': {
		titel: 'Funktionen & Automatisierungen',
		was: 'Alle automatischen Funktionen des CRM auf einen Blick, geordnet nach dem Weg Ihres Kunden. Dort sehen Sie, was passiert und wann, und schalten ein oder aus.',
		wirkt: 'Ihre ganze Firma.',
		standard: 'Wie in den jeweiligen Einstellungen.',
		beispiel: 'Sie sehen sofort, ob die Auftragsbestätigung automatisch entsteht.'
	}
};

export const infoFuer = (id: string): Info | undefined => INFOS[id];
