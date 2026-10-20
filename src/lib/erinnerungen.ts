/**
 * Erinnerungen (Wunsch Jamil msg 2679) – reine Funktionen: Auswahl im Formular, Texte, Prüfung, gesprochene Angaben
 * („eine Stunde vorher“, „einen Tag vorher“, „5 Stunden vorher“).
 */

export const MAX_ERINNERUNGEN = 2;
/** Höchstens 30 Tage vorher. */
export const MAX_MINUTEN_VORHER = 43_200;

/** Auswahl im Formular (Minuten vor Fälligkeit bzw. Terminbeginn). */
export const VORLAUF_AUSWAHL: readonly { minuten: number; text: string }[] = [
	{ minuten: 0, text: 'zur Fälligkeit' },
	{ minuten: 15, text: '15 Minuten vorher' },
	{ minuten: 30, text: '30 Minuten vorher' },
	{ minuten: 60, text: '1 Stunde vorher' },
	{ minuten: 120, text: '2 Stunden vorher' },
	{ minuten: 300, text: '5 Stunden vorher' },
	{ minuten: 1440, text: '1 Tag vorher' },
	{ minuten: 2880, text: '2 Tage vorher' },
	{ minuten: 10080, text: '1 Woche vorher' }
];

export type ErinnerungEingabe = { minuten: number } | { zeitpunkt: string };

/** „1 Stunde vorher“, „90 Minuten vorher“, „2 Tage vorher“. */
export function vorlaufText(minuten: number): string {
	if (minuten === 0) return 'zur Fälligkeit';
	const einheit = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele} vorher`;
	if (minuten % 10080 === 0) return einheit(minuten / 10080, 'Woche', 'Wochen');
	if (minuten % 1440 === 0) return einheit(minuten / 1440, 'Tag', 'Tage');
	if (minuten % 60 === 0) return einheit(minuten / 60, 'Stunde', 'Stunden');
	return einheit(minuten, 'Minute', 'Minuten');
}

/**
 * Formularwert → Eingabe: „60“ (Minuten vorher) oder „zeit:2026-10-23T08:00“ (fester Zeitpunkt, Berliner Zeit wird
 * auf dem Server umgerechnet). Leer = keine Erinnerung.
 */
export function erinnerungAusFeld(w: unknown): { minuten: number } | { ortszeit: string } | null {
	if (w === null || w === undefined || w === '') return null;
	const s = String(w).trim();
	if (/^\d{1,5}$/.test(s)) return { minuten: Number(s) };
	const m = /^zeit:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(s);
	if (m) return { ortszeit: `${m[1]}T${m[2]}` };
	return { ortszeit: '' };
}

const ZAHLWOERTER: Record<string, number> = {
	ein: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8,
	neun: 9, zehn: 10, zwölf: 12, zwoelf: 12, fünfzehn: 15, zwanzig: 20, dreißig: 30, halbe: 0.5, halben: 0.5
};

/** „eine Stunde vorher“ → 60, „einen Tag vorher“ → 1440, „30 Minuten vorher“ → 30, „eine halbe Stunde“ → 30; sonst null. */
export function vorlaufAusText(s: string): number | null {
	const t = s.toLowerCase().replace(/ß/g, 'ß');
	if (/\bhalbe[n]?\s+stunde\b/.test(t)) return 30;
	const m = /\b(\d{1,3}|[a-zäöüß]+)\s+(minute|minuten|min|stunde|stunden|std|tag|tage|tagen|woche|wochen)\b/.exec(t);
	if (!m) return null;
	const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ZAHLWOERTER[m[1]];
	if (!n) return null;
	const faktor = m[2].startsWith('min') ? 1 : m[2].startsWith('st') ? 60 : m[2].startsWith('tag') ? 1440 : 10080;
	const minuten = Math.round(n * faktor);
	return minuten > 0 && minuten <= MAX_MINUTEN_VORHER ? minuten : null;
}

/** Teile eines Erinnerungs-Satzes: „einen Tag vorher und eine Stunde vorher“ → ['einen Tag vorher', 'eine Stunde vorher']. */
export const erinnerungsTeile = (satz: string) =>
	satz
		.split(/\s*(?:,|\bund\b|\bsowie\b)\s*/i)
		.map((x) => x.trim())
		.filter(Boolean)
		.slice(0, MAX_ERINNERUNGEN);

/** Push-Dienste der Browser (Chrome/Android, Firefox, Edge/Windows, Safari/iOS) – exakt bzw. Unterdomain mit Punkt. */
const PUSH_HOSTS_GENAU = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOSTS_ENDUNG = ['.notify.windows.com', '.push.apple.com'];

/**
 * Darf an diese Push-Adresse gesendet werden? Nur https, nur bekannte Push-Dienste (sonst könnte jemand den Server
 * Anfragen ins interne Netz schicken lassen – SSRF), keine IP-Adressen, kein eigener Port, keine Zugangsdaten in der URL.
 */
export function istPushEndpunkt(adresse: unknown): boolean {
	if (typeof adresse !== 'string' || adresse.length > 1000) return false;
	let u: URL;
	try {
		u = new URL(adresse);
	} catch {
		return false;
	}
	if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false;
	const host = u.hostname.toLowerCase();
	if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9.]+$/.test(host) || host.endsWith('.')) return false;
	if (u.pathname.length < 2) return false;
	return PUSH_HOSTS_GENAU.includes(host) || PUSH_HOSTS_ENDUNG.some((e) => host.endsWith(e) && host.length > e.length);
}
