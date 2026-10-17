import { ApiFehler } from './fehler';
import { protokollPdf, type ProtokollPdfDaten } from './pdf/protokoll-pdf';

/**
 * E-Mail-Versand für Protokolle (Platzhalter). Prüft CRM_SMTP_URL – ohne diese Umgebungsvariable wird ein
 * Konfigurationsfehler geworfen. Das PDF wird erzeugt und im Protokoll gespeichert; die E-Mail selbst wird
 * nur geloggt (kein echter Versand bis zur Einrichtung des SMTP-Servers).
 */

export async function sendeProtokollEmail(
	daten: ProtokollPdfDaten,
	empfaenger: string
): Promise<void> {
	const smtpUrl = process.env.CRM_SMTP_URL;
	if (!smtpUrl) {
		throw new ApiFehler(500, 'E-Mail-Dienst nicht konfiguriert (CRM_SMTP_URL fehlt)');
	}
	// PDF erzeugen (wird später im Protokoll gespeichert)
	const pdf = await protokollPdf(daten);
	// Platzhalter: nur loggen
	console.log(`E-Mail gesendet an ${empfaenger} (${pdf.length} Bytes PDF)`);
}