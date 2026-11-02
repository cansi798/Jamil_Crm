/**
 * Bevorzugter Kommunikationsweg eines Kunden (Wunsch Jamil, Talk msgs 4289/4291): E-Mail, Chat oder Telefon.
 * Leer (null) = keine Angabe. Reine Werte ohne Serverbezug – Formular, Anzeige, Filter und Server nutzen dieselbe Liste
 * (Datenbank: CHECK in Migration 115).
 */

export const KONTAKTWEGE = ['email', 'chat', 'telefon'] as const;
export type Kontaktweg = (typeof KONTAKTWEGE)[number];

export const KONTAKTWEG_NAMEN: Record<Kontaktweg, string> = { email: 'E-Mail', chat: 'Chat', telefon: 'Telefon' };

/**
 * Auswahl im Kundenformular: „Keine Angabe“ zuerst. `aria` = Name des Radio-Felds, damit er nicht mit den Feldern
 * „Telefon“ und „E-Mail“ desselben Formulars verwechselt wird (Screenreader, Tests).
 */
const ARIA: Record<'' | Kontaktweg, string> = { '': 'Kontaktweg: keine Angabe', email: 'Kontaktweg: per Mail', chat: 'Kontaktweg: per Chat', telefon: 'Kontaktweg: per Anruf' };
export const KONTAKTWEG_OPTIONEN: readonly { wert: '' | Kontaktweg; text: string; aria: string }[] = [
	{ wert: '', text: 'Keine Angabe', aria: ARIA[''] },
	...KONTAKTWEGE.map((w) => ({ wert: w, text: KONTAKTWEG_NAMEN[w], aria: ARIA[w] }))
];

export const istKontaktweg = (w: unknown): w is Kontaktweg => typeof w === 'string' && (KONTAKTWEGE as readonly string[]).includes(w);

/** Filter der Kundenliste (`?kontakt=`): einer der drei Wege oder „ohne“ (keine Angabe); alles andere = kein Filter. */
export type KontaktwegFilter = Kontaktweg | 'ohne';
export function kontaktwegFilter(w: string | null | undefined): KontaktwegFilter | null {
	if (w === 'ohne') return 'ohne';
	return istKontaktweg(w) ? w : null;
}
