import { ApiFehler } from './fehler';
import type { Kontext } from './db';
import { protokollPdf, type ProtokollPdfDaten } from './pdf/protokoll-pdf';
import { sendeMail } from './mail/versand';

/**
 * E-Mail-Versand für Protokolle über das Postfach des Betriebs (Einstellungen → E-Mail-Versand; Plan Lexware Phase 1).
 * Ohne eingerichtetes Postfach: 409 mit Hinweis (vorher nur ein Log-Eintrag). Jede Mail steht im Versandprotokoll.
 */
export async function sendeProtokollEmail(
	k: Kontext,
	daten: ProtokollPdfDaten,
	empfaenger: string,
	protokollId?: string
): Promise<void> {
	const pdf = await protokollPdf(daten);
	const titel = `Protokoll ${daten.protokoll.nummer}${daten.protokoll.auftragNummer ? ` zu Auftrag ${daten.protokoll.auftragNummer}` : ''}`;
	const text = `Guten Tag,\n\nanbei erhalten Sie das ${titel} als PDF.\n\nMit freundlichen Grüßen\n${daten.profil?.firmenname ?? ''}`.trim();
	const r = await sendeMail(
		k,
		{ an: empfaenger, betreff: titel, text, html: text.split('\n').map((z) => z.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)).join('<br>'), anhaenge: [{ name: `Protokoll_${daten.protokoll.nummer}.pdf`, typ: 'application/pdf', bytes: pdf }] },
		{ art: 'protokoll', bezugTyp: 'protokoll', bezugId: protokollId ?? null }
	);
	if (r.status === 'kein_versand') throw new ApiFehler(409, 'Der Mailversand ist noch nicht eingerichtet (Einstellungen → E-Mail-Versand). Bitte das PDF herunterladen und im Mailprogramm senden.');
	if (r.status === 'fehler') throw new ApiFehler(502, `Die Mail konnte nicht gesendet werden: ${r.fehler}`);
}
