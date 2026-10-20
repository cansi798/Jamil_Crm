import { ApiFehler } from './fehler';
import { abfrageGrenze, buchenGrenzeIp } from './buchung-schutz';

/**
 * Kleine Helfer für die öffentlichen Endpunkte der Online-Buchung: IP-Adresse (hinter einem Proxy mit
 * ADDRESS_HEADER/XFF_DEPTH von adapter-node), Begrenzung und Kopfzeilen (nie zwischenspeichern, nicht indexieren,
 * kein Referrer – der Link enthält ein Token).
 */

export function ipVon(event: { getClientAddress: () => string }): string {
	try {
		return event.getClientAddress() || 'unbekannt';
	} catch {
		return 'unbekannt';
	}
}

export const OEFFENTLICHE_KOPFZEILEN = {
	'cache-control': 'private, no-store',
	'x-robots-tag': 'noindex, nofollow',
	'referrer-policy': 'no-referrer'
} as const;

export function begrenzeAbfrage(ip: string): void {
	if (!abfrageGrenze.pruefeVersuch(`ip:${ip}`).erlaubt) throw new ApiFehler(429, 'Zu viele Anfragen – bitte in einigen Minuten erneut versuchen.');
}

export function begrenzeAenderung(ip: string): void {
	if (!buchenGrenzeIp.pruefeVersuch(`ip:${ip}`).erlaubt) throw new ApiFehler(429, 'Zu viele Anfragen – bitte später erneut versuchen.');
}

export const jsonAntwort = (koerper: unknown, status = 200) =>
	new Response(JSON.stringify(koerper), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...OEFFENTLICHE_KOPFZEILEN } });
