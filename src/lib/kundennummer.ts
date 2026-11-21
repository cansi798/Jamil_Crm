/**
 * Kundennummer im ganzen CRM (Can #6748): Es gilt die Nummer, die Lexware vergibt (Kontakt-Rolle „Kunde“,
 * roles.customer.number). Die interne ID bleibt im Hintergrund. Solange es keine Nummer gibt (ohne Lexware-Verbindung
 * oder bevor Lexware geantwortet hat), steht überall derselbe Hinweis.
 */
export const KUNDENNUMMER_FOLGT = 'Kundennummer folgt von Lexware';

/** „Kd.-Nr. 10001“ bzw. der Hinweis. */
export const kundennummerText = (nr: number | null | undefined, kurz = true): string =>
	typeof nr === 'number' && nr > 0 ? `${kurz ? 'Kd.-Nr.' : 'Kundennummer'} ${nr}` : KUNDENNUMMER_FOLGT;
