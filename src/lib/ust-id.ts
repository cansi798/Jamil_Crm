/**
 * Grobe Formatprüfung der USt-IdNr. nach Länderpräfix (Can #6739: „grob nach Länderpräfix, keine Online-Prüfung“).
 * Muster nach den amtlichen Aufbauregeln der EU-Staaten (MIAS) bzw. der Schweiz (UID „CHE-123.456.789 MWST“) – nur die
 * Form, nicht die Prüfziffer. Leerzeichen werden entfernt, Buchstaben groß geschrieben.
 */
const MUSTER: Record<string, RegExp> = {
	DE: /^DE\d{9}$/,
	AT: /^ATU\d{8}$/,
	CH: /^CHE-?\d{3}\.?\d{3}\.?\d{3}(MWST|TVA|IVA)?$/,
	LI: /^LI\d{5}$/,
	LU: /^LU\d{8}$/,
	NL: /^NL\d{9}B\d{2}$/,
	BE: /^BE[01]\d{9}$/,
	FR: /^FR[0-9A-HJ-NP-Z]{2}\d{9}$/,
	DK: /^DK\d{8}$/,
	PL: /^PL\d{10}$/,
	CZ: /^CZ\d{8,10}$/,
	IT: /^IT\d{11}$/,
	ES: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/,
	PT: /^PT\d{9}$/,
	SE: /^SE\d{12}$/,
	FI: /^FI\d{8}$/,
	IE: /^IE\d[0-9A-Z+*]\d{5}[A-Z]{1,2}$/,
	EL: /^EL\d{9}$/,
	HU: /^HU\d{8}$/,
	SK: /^SK\d{10}$/,
	SI: /^SI\d{8}$/,
	HR: /^HR\d{11}$/,
	RO: /^RO\d{2,10}$/,
	BG: /^BG\d{9,10}$/,
	EE: /^EE\d{9}$/,
	LV: /^LV\d{11}$/,
	LT: /^LT(\d{9}|\d{12})$/,
	MT: /^MT\d{8}$/,
	CY: /^CY\d{8}[A-Z]$/,
	XI: /^XI(\d{9}|\d{12})$/,
	GB: /^GB(\d{9}|\d{12})$/,
	NO: /^NO\d{9}(MVA)?$/
};
/** Präfix der USt-IdNr. → Land (Griechenland nutzt „EL“, Nordirland „XI“). */
const PRAEFIX_LAND: Record<string, string> = { EL: 'GR', XI: 'GB', CHE: 'CH' };

export type UstIdErgebnis = { ok: true; wert: string; land: string } | { ok: false; fehler: string };

/** Normalisieren und grob prüfen. Leer → null (keine Angabe). */
export function pruefeUstId(roh: string | null | undefined): UstIdErgebnis | null {
	const wert = (roh ?? '').replace(/\s+/g, '').toUpperCase();
	if (!wert) return null;
	if (!/^[A-Z]{2}/.test(wert)) return { ok: false, fehler: 'Die USt-IdNr. beginnt mit dem Länderkürzel, z. B. DE123456789.' };
	if (wert.length > 20) return { ok: false, fehler: 'Die USt-IdNr. ist zu lang.' };
	const praefix = wert.slice(0, 2);
	const muster = MUSTER[praefix];
	if (muster) {
		if (!muster.test(wert)) return { ok: false, fehler: `Die USt-IdNr. passt nicht zum Aufbau für ${praefix} (z. B. ${BEISPIEL[praefix] ?? `${praefix}…`}).` };
	} else if (!/^[A-Z]{2}[0-9A-Z]{2,14}$/.test(wert)) return { ok: false, fehler: 'Die USt-IdNr. enthält ungültige Zeichen.' };
	const land = wert.startsWith('CHE') ? 'CH' : (PRAEFIX_LAND[praefix] ?? praefix);
	return { ok: true, wert, land };
}

const BEISPIEL: Record<string, string> = {
	DE: 'DE123456789',
	AT: 'ATU12345678',
	CH: 'CHE-123.456.789 MWST',
	NL: 'NL123456789B01',
	FR: 'FR12345678901',
	IT: 'IT12345678901',
	BE: 'BE0123456789',
	PL: 'PL1234567890',
	LU: 'LU12345678',
	DK: 'DK12345678'
};

/** Steuernummer (deutsch, z. B. „12/345/67890“ oder 13-stellig): nur Ziffern, Leerzeichen, „/“, „.“, „-“; 5–30 Zeichen. */
export function pruefeSteuernummer(roh: string | null | undefined): { ok: true; wert: string } | { ok: false; fehler: string } | null {
	const wert = (roh ?? '').trim().replace(/\s+/g, ' ');
	if (!wert) return null;
	if (!/^[0-9 /.-]+$/.test(wert)) return { ok: false, fehler: 'Die Steuernummer darf nur Ziffern, Leerzeichen und „/“ enthalten.' };
	if (wert.length < 5 || wert.length > 30 || wert.replace(/\D/g, '').length < 5) return { ok: false, fehler: 'Die Steuernummer ist zu kurz oder zu lang.' };
	return { ok: true, wert };
}
