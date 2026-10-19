/**
 * KI-Angebotsentwurf (Stufe 1d) – Wissen ohne Serverbezug, auch für den Editor: Positionen, bei denen die KI unsicher
 * war (oder einen eigenen Preis nennen wollte), beginnen in der Beschreibung mit diesem Hinweis und werden im Editor
 * gelb markiert, bis ein Mensch die Beschreibung anpasst.
 */
export const KI_PRUEF_MARKER = 'Bitte prüfen (KI-Vorschlag)';

export const istKiPruefen = (beschreibung: string | null | undefined): boolean =>
	typeof beschreibung === 'string' && beschreibung.includes(KI_PRUEF_MARKER);
