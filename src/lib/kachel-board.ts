/** Eine Spalte des gemeinsamen Kachel-Boards (`KachelBoard.svelte`: Aufträge, To-dos). */
export type KachelSpalte<T> = {
	id: string;
	titel: string;
	/** Farbe des Spaltenkopfs (CSS-Wert). */
	farbe: string;
	/** Gesamtzahl der Spalte (kann größer sein als die geladenen Karten). */
	anzahl?: number;
	karten: T[];
};
