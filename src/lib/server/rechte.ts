import type { Kontext } from './db';
import { ApiFehler } from './fehler';

/** Alle Rechte (Schlüssel → deutsche Beschriftung). Rollen bestehen aus einer frei gewählten Menge davon. */
export const RECHTE = {
	'kunden.lesen': 'Kunden ansehen',
	'kunden.bearbeiten': 'Kunden anlegen und ändern',
	'auftraege.lesen': 'Eigene Aufträge ansehen',
	'auftraege.alle_lesen': 'Alle Aufträge ansehen',
	'todos.alle_lesen': 'Alle Aufgaben ansehen',
	'auftraege.bearbeiten': 'Aufträge anlegen und ändern',
	'plantafel.bearbeiten': 'Plantafel bearbeiten',
	'angebote.bearbeiten': 'Angebote und Rechnungen bearbeiten',
	'preise.sehen': 'Preise und Beträge sehen',
	'katalog.bearbeiten': 'Katalog und Leistungen bearbeiten',
	'protokolle.lesen': 'Protokolle ansehen',
	'protokolle.bearbeiten': 'Protokolle anlegen und ändern',
	'protokolle.ausfuellen': 'Protokolle ausfüllen (Formulare)',
	'protokolle.vorlagen_bearbeiten': 'Protokoll-Vorlagen gestalten',
	'erinnerungen.nutzen': 'Erinnerungen für Aufgaben und Termine nutzen',
	'buchung.verwalten': 'Online-Buchung verwalten (Dienste, Buchungslinks)',
	'zeiterfassung.nutzen': 'Zeiterfassung nutzen (eigene Zeiten, Fahrt, Material)',
	'zeiterfassung.alle_sehen': 'Zeiten aller Mitarbeiter sehen, korrigieren und freigeben',
	'kundenportal.verwalten': 'Kundenportal verwalten (Links für Kunden, Freigaben)',
	'benutzer.verwalten': 'Benutzer verwalten',
	einstellungen: 'Einstellungen verwalten'
} as const;

export type Recht = keyof typeof RECHTE;

export const ALLE_RECHTE = Object.keys(RECHTE) as Recht[];

export const istRecht = (wert: unknown): wert is Recht =>
	typeof wert === 'string' && Object.hasOwn(RECHTE, wert);

/** Startpunkte für neue Rollen; eine Vorlage wird beim Anlegen kopiert und kann danach frei geändert werden. */
export const VORLAGEN = {
	chef: ALLE_RECHTE,
	// Online-Buchung (Wunsch Jamil msgs 2684/2686) standardmäßig nur der Chef; in „Rollen“ vergebbar
	buero: ALLE_RECHTE.filter((r) => r !== 'einstellungen' && r !== 'benutzer.verwalten' && r !== 'buchung.verwalten'),
	monteur: ['kunden.lesen', 'auftraege.lesen', 'protokolle.ausfuellen', 'erinnerungen.nutzen', 'zeiterfassung.nutzen']
} as const satisfies Record<string, readonly Recht[]>;

export type Vorlage = keyof typeof VORLAGEN;

export const VORLAGEN_NAMEN: Record<Vorlage, string> = {
	chef: 'Chef',
	buero: 'Büro',
	monteur: 'Monteur'
};

export const istVorlage = (wert: unknown): wert is Vorlage =>
	typeof wert === 'string' && Object.hasOwn(VORLAGEN, wert);

export function hatRecht(nutzer: Nutzer, recht: Recht): boolean {
	return nutzer.rechte.includes(recht);
}

/** Wirft 401 ohne Anmeldung und 403 ohne das Recht. */
export function pruefeRecht(locals: { nutzer: Nutzer | null }, recht: Recht): void {
	if (!locals.nutzer) throw new ApiFehler(401, 'Nicht angemeldet');
	if (!hatRecht(locals.nutzer, recht)) throw new ApiFehler(403, 'Keine Berechtigung');
}

/** Mandantenkontext für `mitBetrieb`. Plattform-Admins haben keinen Betrieb und damit keinen fachlichen Zugriff. */
export function betriebKontext(locals: { nutzer: Nutzer | null }): Kontext {
	const n = locals.nutzer;
	if (!n) throw new ApiFehler(401, 'Nicht angemeldet');
	if (!n.betriebId) throw new ApiFehler(403, 'Keine Berechtigung');
	return { betriebId: n.betriebId, benutzerId: n.id };
}
