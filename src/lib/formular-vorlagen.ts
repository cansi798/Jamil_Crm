/**
 * Protokoll- und Aufmaß-Vorlagen (gleicher Baukasten, Tabelle `protokoll_vorlagen`, Spalte `art`) haben je eine eigene
 * Adresse – so markiert das Menü genau einen Eintrag (Jamil msg 3085; früher `?art=aufmass` auf derselben Seite).
 */
export type FormularVorlagenArt = 'protokoll' | 'aufmass';

export const FORMULAR_VORLAGEN: Record<FormularVorlagenArt, { pfad: string; titel: string; einzeln: string; ding: string; mehrere: string }> = {
	protokoll: { pfad: '/einstellungen/protokoll-vorlagen', titel: 'Protokoll-Vorlagen', einzeln: 'Protokoll-Vorlage', ding: 'Protokoll', mehrere: 'Protokolle' },
	aufmass: { pfad: '/einstellungen/aufmass-vorlagen', titel: 'Aufmaß-Vorlagen', einzeln: 'Aufmaß-Vorlage', ding: 'Aufmaß', mehrere: 'Aufmaße' }
};

/** Adresse der Liste bzw. einer Vorlage. */
export const formularVorlagenPfad = (art: FormularVorlagenArt, id?: string) => (id ? `${FORMULAR_VORLAGEN[art].pfad}/${id}` : FORMULAR_VORLAGEN[art].pfad);
