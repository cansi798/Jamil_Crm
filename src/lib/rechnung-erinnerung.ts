/** Erinnerung „Rechnung erstellen“ (Jamil msgs 6525/6527/6530): Werte ohne Serverbezug für Seite und Server. */

/** Wem die Erinnerung zugewiesen wird – selbst bestimmbar je Betrieb (Jamil msg 6530; Migration 123). */
export const ZUWEISUNGEN = ['standard', 'person', 'rolle'] as const;
export type Zuweisung = (typeof ZUWEISUNGEN)[number];
export const ZUWEISUNG_NAMEN: Record<Zuweisung, string> = {
	standard: 'Büro, sonst Chef (Standard)',
	person: 'Eine feste Person',
	rolle: 'Eine Rolle'
};
export type ErinnerungEinstellung = { zuweisung: Zuweisung; benutzerId: string | null; rolleId: string | null };
export const STANDARD_EINSTELLUNG: ErinnerungEinstellung = { zuweisung: 'standard', benutzerId: null, rolleId: null };

