/**
 * Automatisches Nachfassen (Wünsche Jamil, msgs 2585, 2633, 2636) – reine Funktionen ohne Datenbank: Platzhalter
 * füllen, HTML in Klartext wandeln (für mailto: und „Text kopieren“), Signatur einsetzen, fällige Stufe bestimmen.
 */

export const NACHFASS_ARTEN = ['angebot', 'rechnung'] as const;
export type NachfassArt = (typeof NACHFASS_ARTEN)[number];
export const NACHFASS_ART_NAMEN: Record<NachfassArt, string> = { angebot: 'Angebot', rechnung: 'Rechnung' };

export const ZUWEISUNGEN = ['zustaendig', 'fest', 'rolle'] as const;
export type Zuweisung = (typeof ZUWEISUNGEN)[number];
export const ZUWEISUNG_NAMEN: Record<Zuweisung, string> = {
	zustaendig: 'Zuständiger des Auftrags',
	fest: 'fester Mitarbeiter',
	rolle: 'Rolle (erster aktiver Benutzer)'
};

/** Platzhalter mit Beschreibung (für die Einstellungen). */
export const PLATZHALTER: readonly [string, string][] = [
	['kunde.name', 'Name des Kunden (Firma bzw. Vor- und Nachname)'],
	['kunde.anrede', 'Briefanrede, z. B. „Sehr geehrter Herr Müller“'],
	['kunde.email', 'E-Mail des Kunden'],
	['angebot.nummer', 'Angebotsnummer'],
	['angebot.datum', 'Angebotsdatum'],
	['angebot.gueltig_bis', 'Angebot gültig bis'],
	['auftrag.titel', 'Titel des Auftrags'],
	['betrag', 'Betrag brutto'],
	['faellig_am', 'Fällig am (Angebot: gültig bis)'],
	['tage', 'Tage seit dem Versand'],
	['link', 'Link (Website des Betriebs)'],
	['firma.name', 'Name des Betriebs'],
	['firma.telefon', 'Telefon des Betriebs'],
	['signatur', 'Firmensignatur (sonst automatisch am Ende)']
];

export const BEISPIEL_WERTE: Record<string, string> = {
	'kunde.name': 'Familie Müller',
	'kunde.anrede': 'Sehr geehrte Familie Müller',
	'kunde.email': 'mueller@example.org',
	'angebot.nummer': 'AN-2026-0042',
	'angebot.datum': '05.10.2026',
	'angebot.gueltig_bis': '04.11.2026',
	'auftrag.titel': 'Badsanierung',
	betrag: '12.480,00 €',
	faellig_am: '04.11.2026',
	tage: '7',
	link: 'https://www.example.org',
	'firma.name': 'Muster Handwerk GmbH',
	'firma.telefon': '040 123456'
};

const maskiere = (s: string) =>
	s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** {{platzhalter}} ersetzen (Leerzeichen erlaubt); unbekannte werden leer. Im HTML werden Werte maskiert. */
export function fuelle(vorlage: string, werte: Record<string, string>, html: boolean): string {
	return vorlage.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, schluessel: string) => {
		if (schluessel === 'signatur') return '{{signatur}}';
		const w = werte[schluessel] ?? '';
		return html ? maskiere(w) : w;
	});
}

/** Signatur an der Stelle {{signatur}} – sonst ans Ende; ohne Signatur fällt der Platzhalter weg. */
export function mitSignatur(html: string, signatur: string | null): string {
	if (html.includes('{{signatur}}')) return html.replaceAll('{{signatur}}', signatur ?? '');
	return signatur ? `${html}\n${signatur}` : html;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', apos: "'" };

/** Einfaches HTML → Klartext (Absätze, Umbrüche, Listen, Links mit URL); Skripte/Styles fallen weg. */
export function htmlZuText(html: string): string {
	let t = html
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
		.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
			const sichtbar = text.replace(/<[^>]+>/g, '').trim();
			return sichtbar && sichtbar !== href ? `${sichtbar} (${href})` : href;
		})
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<li[^>]*>/gi, '\n- ')
		.replace(/<\/(p|div|h[1-6]|ul|ol|table|tr)>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (_, e: string) => ENTITIES[e]);
	t = t
		.split('\n')
		.map((z) => z.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return t;
}

/** mailto:-Link (Zeilenumbrüche als CRLF); sehr lange Texte werden gekürzt, damit Mailprogramme ihn öffnen. */
export function mailtoLink(an: string | null, betreff: string, text: string, max = 1800): string {
	let body = text.replace(/\r?\n/g, '\r\n');
	if (body.length > max) body = `${body.slice(0, max)}\r\n[…] (vollständiger Text: „Text kopieren“ im CRM)`;
	return `mailto:${encodeURIComponent(an ?? '')}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;
}

const tagPlus = (tag: string, n: number) => new Date(Date.parse(`${tag}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Welche Stufe ist heute fällig? Die jüngste (größte Tageszahl), deren Termin erreicht ist und die noch nicht lief –
 * und nur, wenn keine spätere Stufe schon lief. So entstehen nach längerer Pause nicht alle Stufen auf einmal.
 */
export function faelligeStufe<T extends { id: string; tage: number }>(startTag: string, heute: string, stufen: readonly T[], gelaufen: readonly string[]): T | null {
	const fertig = new Set(gelaufen);
	const sortiert = [...stufen].sort((a, b) => a.tage - b.tage);
	const letzteGelaufen = Math.max(-1, ...sortiert.filter((s) => fertig.has(s.id)).map((s) => s.tage));
	const faellig = sortiert.filter((s) => tagPlus(startTag, s.tage) <= heute && !fertig.has(s.id) && s.tage > letzteGelaufen);
	return faellig.at(-1) ?? null;
}

/** Vorschlag „Standard übernehmen“ (Jamils Beispiel msg 2636): Tag 3 Mail, Tag 7 Anruf, Tag 14 Mail + To-do für den Chef. */
export const STANDARD_VORLAGEN = [
	{
		schluessel: 'freundlich',
		name: 'Angebot – freundlich nachfragen',
		betreff: 'Ihr Angebot {{angebot.nummer}}',
		html:
			'<p>{{kunde.anrede}},</p><p>vor einigen Tagen haben wir Ihnen unser Angebot {{angebot.nummer}} über {{betrag}} geschickt. ' +
			'Haben Sie noch Fragen dazu? Wir beraten Sie gern – rufen Sie uns einfach an oder antworten Sie auf diese Mail.</p>' +
			'<p>Mit freundlichen Grüßen</p>{{signatur}}'
	},
	{
		schluessel: 'erinnerung',
		name: 'Angebot – Erinnerung vor Ablauf',
		betreff: 'Erinnerung: Angebot {{angebot.nummer}} gilt bis {{angebot.gueltig_bis}}',
		html:
			'<p>{{kunde.anrede}},</p><p>unser Angebot {{angebot.nummer}} ist noch bis {{angebot.gueltig_bis}} gültig. ' +
			'Gern reservieren wir Ihnen einen Termin – geben Sie uns einfach kurz Bescheid.</p><p>Mit freundlichen Grüßen</p>{{signatur}}'
	}
] as const;

export const STANDARD_STUFEN = [
	{ tage: 3, todo: false, mail: true, vorlage: 'freundlich', todoTitel: null, zuweisung: 'zustaendig' },
	{ tage: 7, todo: true, mail: false, vorlage: null, todoTitel: 'Kunde anrufen: {{kunde.name}} – Angebot {{angebot.nummer}}', zuweisung: 'zustaendig' },
	{ tage: 14, todo: true, mail: true, vorlage: 'erinnerung', todoTitel: 'Angebot {{angebot.nummer}} ({{kunde.name}}) noch offen – nachhaken', zuweisung: 'rolle' }
] as const;
