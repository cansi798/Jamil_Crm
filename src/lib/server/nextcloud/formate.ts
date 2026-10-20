import { createHash } from 'node:crypto';

/**
 * iCalendar (RFC 5545) und vCard 3.0 (RFC 2426) – ohne Abhängigkeit, nur was der Abgleich braucht.
 * Texte werden maskiert (\\ ; , Zeilenumbruch) und Zeilen nach 75 Oktetten gefaltet; Steuerzeichen fliegen raus
 * (keine Eigenschafts-Injektion über Kundennamen o. Ä.).
 */

export const pruefsumme = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

export function maskiere(t: string): string {
	return t
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/** Zeile nach 75 Oktetten falten (Fortsetzung beginnt mit Leerzeichen), ohne UTF-8-Zeichen zu zerschneiden. */
export function falte(zeile: string): string {
	const teile: string[] = [];
	let aktuell = '';
	let bytes = 0;
	for (const z of zeile) {
		const n = Buffer.byteLength(z);
		const grenze = teile.length === 0 ? 75 : 74;
		if (bytes + n > grenze) {
			teile.push(aktuell);
			aktuell = '';
			bytes = 0;
		}
		aktuell += z;
		bytes += n;
	}
	teile.push(aktuell);
	return teile.join('\r\n ');
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export type Termin = {
	uid: string;
	titel: string;
	beginn: Date;
	ende: Date;
	ort?: string | null;
	beschreibung?: string | null;
	link?: string | null;
	geaendert: Date;
};

export function ical(t: Termin): string {
	const z = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//CRM System//Nextcloud-Abgleich//DE',
		'CALSCALE:GREGORIAN',
		'BEGIN:VEVENT',
		`UID:${maskiere(t.uid)}`,
		`DTSTAMP:${utc(t.geaendert)}`,
		`LAST-MODIFIED:${utc(t.geaendert)}`,
		`DTSTART:${utc(t.beginn)}`,
		`DTEND:${utc(t.ende)}`,
		`SUMMARY:${maskiere(t.titel.slice(0, 300))}`
	];
	if (t.ort) z.push(`LOCATION:${maskiere(t.ort.slice(0, 500))}`);
	if (t.beschreibung) z.push(`DESCRIPTION:${maskiere(t.beschreibung.slice(0, 2000))}`);
	if (t.link && /^https?:\/\//.test(t.link)) z.push(`URL:${t.link.replace(/[\r\n]/g, '')}`);
	z.push('TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');
	return z.map(falte).join('\r\n') + '\r\n';
}

export type Kontakt = {
	uid: string;
	firma?: string | null;
	vorname?: string | null;
	nachname?: string | null;
	anrede?: string | null;
	email?: string | null;
	telefon?: string | null;
	strasse?: string | null;
	plz?: string | null;
	ort?: string | null;
	notiz?: string | null;
	geaendert: Date;
};

export function vcard(k: Kontakt): string {
	const person = [k.vorname, k.nachname].filter(Boolean).join(' ').trim();
	const fn = (k.firma && !person ? k.firma : person || k.firma || 'Kunde').slice(0, 300);
	const z = [
		'BEGIN:VCARD',
		'VERSION:3.0',
		'PRODID:-//CRM System//Nextcloud-Abgleich//DE',
		`UID:${maskiere(k.uid)}`,
		`FN:${maskiere(fn)}`,
		`N:${maskiere(k.nachname ?? (person ? '' : fn))};${maskiere(k.vorname ?? '')};;${maskiere(k.anrede ?? '')};`
	];
	if (k.firma) z.push(`ORG:${maskiere(k.firma)}`);
	if (k.email) z.push(`EMAIL;TYPE=INTERNET:${maskiere(k.email)}`);
	if (k.telefon) z.push(`TEL;TYPE=VOICE:${maskiere(k.telefon)}`);
	if (k.strasse || k.plz || k.ort) {
		z.push(`ADR;TYPE=WORK:;;${maskiere(k.strasse ?? '')};${maskiere(k.ort ?? '')};;${maskiere(k.plz ?? '')};`);
	}
	if (k.notiz) z.push(`NOTE:${maskiere(k.notiz.slice(0, 2000))}`);
	z.push('CATEGORIES:CRM', `REV:${utc(k.geaendert)}`, 'END:VCARD');
	return z.map(falte).join('\r\n') + '\r\n';
}

/** Ordner-/Dateiname für Nextcloud: keine Pfadzeichen, keine Steuerzeichen, nicht leer, höchstens 120 Zeichen. */
export function sichererName(t: string | null | undefined, ersatz = 'Unbenannt'): string {
	const s = (t ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 120)
		.trim();
	return s || ersatz;
}
