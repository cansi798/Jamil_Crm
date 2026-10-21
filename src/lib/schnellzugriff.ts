/**
 * Schnellzugriff unten rechts (Jamil msgs 3078/3079): runder Knopf mit kleinem Menü – Sprachsteuerung, neuer Kunde,
 * neuer Auftrag, neuer Termin, neue Aufgabe. Jeder Eintrag nur mit Modul UND Recht (dieselben Prüfungen wie die
 * Zielseiten; geprüft wird dort serverseitig ohnehin noch einmal).
 */

export type SchnellId = 'sprache' | 'kunde' | 'auftrag' | 'termin' | 'aufgabe';

export type SchnellEintrag = { id: SchnellId; text: string; href: string | null };

/** Reihenfolge von unten (nah am Knopf) nach oben: Sprache zuerst, damit das Mikrofon dort bleibt, wo es war. */
const ALLE: readonly SchnellEintrag[] = [
	{ id: 'sprache', text: 'Sprachsteuerung', href: null },
	{ id: 'kunde', text: 'Neuer Kunde', href: '/kunden/neu' },
	{ id: 'auftrag', text: 'Neuer Auftrag', href: '/auftraege/neu' },
	{ id: 'termin', text: 'Neuer Termin', href: '/plantafel?neu=1' },
	{ id: 'aufgabe', text: 'Neue Aufgabe', href: '/todos?neu=1' }
];

export function schnellzugriff(nutzer: { betriebId: string | null; rechte: readonly string[] }, module: readonly string[]): SchnellEintrag[] {
	if (!nutzer.betriebId) return [];
	const hat = (r: string) => nutzer.rechte.includes(r);
	const erlaubt: Record<SchnellId, boolean> = {
		sprache: module.includes('sprache') && hat('sprache.nutzen'),
		kunde: module.includes('kunden') && hat('kunden.bearbeiten'),
		auftrag: module.includes('auftraege') && hat('auftraege.bearbeiten'),
		// Neuer Termin = Einsatz-Dialog der Plantafel (dort „darfPlanen“)
		termin: module.includes('plantafel') && hat('plantafel.bearbeiten'),
		// Aufgaben-Seite braucht Lesen, „Aufgabe hinzufügen“ zusätzlich „Aufträge bearbeiten“
		aufgabe: module.includes('auftraege') && hat('auftraege.bearbeiten') && (hat('auftraege.lesen') || hat('auftraege.alle_lesen'))
	};
	return ALLE.filter((e) => erlaubt[e.id]);
}
