/**
 * Spalten des Aufgaben-Boards – ohne Svelte und ohne Serverbezug (testbar). „In Arbeit“ heißt (wie bisher): offen und
 * mit Fälligkeit; „Offen“: offen ohne Fälligkeit; „Erledigt“: abgehakt.
 */

export const TODO_SPALTEN = [
	{ id: 'offen', titel: 'Offen', farbe: 'var(--m365-text-leicht)' },
	{ id: 'in-arbeit', titel: 'In Arbeit', farbe: 'var(--m365-primaer)' },
	{ id: 'erledigt', titel: 'Erledigt', farbe: 'var(--m365-erfolg)' }
] as const;

export type TodoSpalte = (typeof TODO_SPALTEN)[number]['id'];

export const todoSpalte = (t: { erledigt: boolean; faellig: string | null }): TodoSpalte =>
	t.erledigt ? 'erledigt' : t.faellig ? 'in-arbeit' : 'offen';

/**
 * Änderung (für PATCH /api/todos/[id]), die eine Aufgabe in die Spalte `nach` bringt:
 * Erledigt → nur abhaken (Fälligkeit bleibt); In Arbeit → offen, Fälligkeit bleibt oder wird heute;
 * Offen → offen ohne Fälligkeit.
 */
export function todoVerschiebung(
	t: { erledigt: boolean; faellig: string | null },
	nach: TodoSpalte,
	heute: string
): { erledigt: boolean; faellig?: string | null } {
	if (nach === 'erledigt') return { erledigt: true };
	if (nach === 'in-arbeit') return { erledigt: false, faellig: t.faellig ?? heute };
	return { erledigt: false, faellig: null };
}
