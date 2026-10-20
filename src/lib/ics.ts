/**
 * Kalenderdatei (.ics, RFC 5545) für einen gebuchten Termin – zum Herunterladen auf der Bestätigungsseite. Zeiten in
 * UTC, Texte maskiert (Komma, Semikolon, Backslash, Zeilenumbruch), Zeilen nach 75 Bytes gefaltet.
 */

export type IcsTermin = {
	uid: string;
	beginn: Date;
	ende: Date;
	titel: string;
	ort?: string | null;
	beschreibung?: string | null;
	/** Zeitpunkt der Erstellung (DTSTAMP) */
	jetzt?: Date;
	abgesagt?: boolean;
};

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function icsText(t: string): string {
	return t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
}

/** Faltet eine Zeile nach höchstens 75 Bytes (UTF-8, ohne Zeichen zu zerteilen). */
export function falte(zeile: string): string {
	const enc = new TextEncoder();
	const teile: string[] = [];
	let aktuell = '';
	let bytes = 0;
	for (const z of zeile) {
		const n = enc.encode(z).length;
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

export function icsDatei(t: IcsTermin): string {
	const zeilen = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//CRM System//Online-Buchung//DE',
		'CALSCALE:GREGORIAN',
		`METHOD:${t.abgesagt ? 'CANCEL' : 'PUBLISH'}`,
		'BEGIN:VEVENT',
		`UID:${icsText(t.uid)}`,
		`DTSTAMP:${utc(t.jetzt ?? new Date())}`,
		`DTSTART:${utc(t.beginn)}`,
		`DTEND:${utc(t.ende)}`,
		`SUMMARY:${icsText(t.titel)}`,
		...(t.ort ? [`LOCATION:${icsText(t.ort)}`] : []),
		...(t.beschreibung ? [`DESCRIPTION:${icsText(t.beschreibung)}`] : []),
		`STATUS:${t.abgesagt ? 'CANCELLED' : 'CONFIRMED'}`,
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return zeilen.map(falte).join('\r\n') + '\r\n';
}
