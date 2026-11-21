/**
 * Land und Suchtext für Lexware (rein, ohne Datenbank).
 *
 * Lexware verlangt in jeder Adresse `countryCode` als ISO 3166 alpha-2 (Doku https://developers.lexware.io/docs/ →
 * „Contacts Endpoint“ → „Address Details“ / „Create a Contact“: „countryCode … Must be not empty“, FAQ „Country Codes“).
 * Das CRM hat kein eigenes Länderfeld; die PLZ ist Freitext (Migration 007: „CH-8001“, „A-1010“, „12345“). Darum wird
 * das Land aus einem Länder-Präfix der PLZ gelesen; ohne Präfix gilt Deutschland.
 */

/** Alte Kfz-/Post-Kennzeichen und ISO-Codes, die in PLZ-Feldern vorkommen → ISO 3166 alpha-2. */
const PRAEFIX: Record<string, string> = {
	D: 'DE', DE: 'DE', A: 'AT', AT: 'AT', CH: 'CH', FL: 'LI', LI: 'LI', F: 'FR', FR: 'FR', B: 'BE', BE: 'BE', L: 'LU', LU: 'LU',
	NL: 'NL', DK: 'DK', PL: 'PL', CZ: 'CZ', I: 'IT', IT: 'IT', E: 'ES', ES: 'ES', S: 'SE', SE: 'SE', N: 'NO', NO: 'NO'
};

export type LandErgebnis = { countryCode: string; zip: string | null; warnung: string | null };

/** „CH-8001“ → CH/8001, „A 1010“ → AT/1010, „24103“ → DE/24103, „1234 AB“ (ohne Präfix) → DE + Warnung. */
export function landAusPlz(plz: string | null | undefined): LandErgebnis {
	const t = (plz ?? '').trim();
	if (!t) return { countryCode: 'DE', zip: null, warnung: null };
	const m = /^([A-Za-z]{1,2})\s*[- ]\s*(.+)$/.exec(t);
	if (m) {
		const land = PRAEFIX[m[1].toUpperCase()];
		if (land) return { countryCode: land, zip: m[2].trim(), warnung: null };
		return { countryCode: 'DE', zip: t, warnung: `Land zur PLZ „${t}“ unbekannt – Lexware erhält „DE“. Bitte Land prüfen.` };
	}
	if (/^\d{5}$/.test(t)) return { countryCode: 'DE', zip: t, warnung: null };
	return { countryCode: 'DE', zip: t, warnung: `PLZ „${t}“ ist keine deutsche PLZ – Lexware erhält „DE“. Bei Auslandskunden Länderkürzel voranstellen (z. B. „AT-1010“).` };
}

/**
 * Suchtext für die Filter `name`/`email` (Contacts) und die Belegliste: Lexware erwartet &, < und > HTML-kodiert UND
 * die Abfrage URL-kodiert (Doku → FAQ „Search String Encoding“: „johnson & partner“ → `johnson%20%26amp%3B%20partner`).
 */
export function suchText(s: string): string {
	return encodeURIComponent(s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}
