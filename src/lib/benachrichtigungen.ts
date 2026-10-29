/**
 * Benachrichtigungen (Jamil, Talk msg 3734) – ohne Serverbezug: Kategorien für die persönlichen Einstellungen und der
 * Text einer gebündelten Nachricht. Angelegt werden die Nachrichten von Datenbank-Triggern (Migration 114).
 */
export const BENACHRICHTIGUNGS_KATEGORIEN = [
	{ id: 'aufgabe', titel: 'Aufgaben', wann: 'Dir wird eine Aufgabe zugewiesen.' },
	{ id: 'termin', titel: 'Termine', wann: 'Du wirst für einen Termin eingeteilt, dein Termin wird verschoben, geändert oder abgesagt.' },
	{ id: 'auftrag', titel: 'Aufträge', wann: 'Du wirst für einen Auftrag zuständig, oder dein Auftrag wechselt den Status.' }
] as const;
export type BenachrichtigungsKategorie = (typeof BENACHRICHTIGUNGS_KATEGORIEN)[number]['id'];
export const istBenachrichtigungsKategorie = (w: unknown): w is BenachrichtigungsKategorie =>
	typeof w === 'string' && BENACHRICHTIGUNGS_KATEGORIEN.some((k) => k.id === w);

/** Text in der Glocke: bei gebündelten Nachrichten mit Anzahl („· 3 Änderungen“). */
export function glockenText(text: string | null, anzahl: number): string | null {
	if (anzahl <= 1) return text;
	const zusatz = `${anzahl} Änderungen`;
	return text ? `${text} · ${zusatz}` : zusatz;
}
