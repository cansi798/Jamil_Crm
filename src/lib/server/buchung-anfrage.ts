import { besucherIp } from './client-ip';
import { ApiFehler } from './fehler';
import { abfrageGrenze, buchenGrenzeIp } from './buchung-schutz';

/**
 * Kleine Helfer für die öffentlichen Endpunkte der Online-Buchung: IP-Adresse (hinter einem Proxy mit
 * CRM_ADRESS_KOPF, nur von vertrauenswürdigem Proxy – client-ip.ts), Begrenzung und Kopfzeilen (nie zwischenspeichern, nicht indexieren,
 * kein Referrer – der Link enthält ein Token).
 */

/**
 * Besucher-IP: X-Forwarded-For nur von einem vertrauenswürdigen Proxy (src/lib/server/client-ip.ts,
 * CRM_ADRESS_KOPF/CRM_ADRESS_TIEFE/CRM_PROXY_VERTRAUEN). `getClientAddress` liefert dafür die Adresse der Verbindung
 * (adapter-node OHNE ADDRESS_HEADER).
 */
export function ipVon(event: { getClientAddress: () => string; request?: Request }): string {
	let peer: string | null = null;
	try {
		peer = event.getClientAddress() || null;
	} catch {
		peer = null;
	}
	return besucherIp(peer, event.request?.headers ?? null);
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
