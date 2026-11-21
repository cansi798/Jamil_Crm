import { isIP } from 'node:net';

/**
 * Besucher-IP hinter einem Proxy (Prüfbericht 21.11.2026): X-Forwarded-For wird NUR übernommen, wenn die Anfrage
 * wirklich von einem vertrauenswürdigen Proxy kommt (Absender-Adresse der Verbindung in CRM_PROXY_VERTRAUEN; Standard:
 * nur lokale und private Netze – dort sitzt der eigene Webserver, Caddy). Wer den App-Port direkt erreicht, kann seine
 * IP so nicht fälschen (Anmelde- und Buchungs-Begrenzungen je IP).
 *
 * Umgebung: CRM_ADRESS_KOPF (z. B. X-Forwarded-For; leer = aus), CRM_ADRESS_TIEFE (1 = letzter Eintrag, den der eigene
 * Proxy anhängt), CRM_PROXY_VERTRAUEN (Komma-Liste aus IPs bzw. IPv4-Netzen „a.b.c.d/n“; „privat“ = Standard).
 */

const PRIVAT = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1', 'fc00::/7'];

const ohneMapping = (ip: string) => (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

function v4Zahl(ip: string): number {
	return ip.split('.').reduce((s, t) => s * 256 + Number(t), 0);
}

function passt(ip: string, regel: string): boolean {
	const [netz, laenge] = regel.split('/');
	if (laenge === undefined) return ohneMapping(netz.toLowerCase()) === ip.toLowerCase();
	const n = Number(laenge);
	if (isIP(netz) === 4 && isIP(ip) === 4 && Number.isInteger(n) && n >= 0 && n <= 32) {
		if (n === 0) return true;
		const maske = n === 32 ? 0xffffffff : (~((1 << (32 - n)) - 1)) >>> 0;
		return ((v4Zahl(ip) & maske) >>> 0) === ((v4Zahl(netz) & maske) >>> 0);
	}
	// IPv6: nur das Präfix fc00::/7 (eindeutig lokale Adressen) wird unterstützt
	if (isIP(ip) === 6 && regel.toLowerCase() === 'fc00::/7') return /^f[cd][0-9a-f]{0,2}:/i.test(ip);
	return false;
}

export function vertrauterProxy(peer: string, env: Record<string, string | undefined> = process.env): boolean {
	const ip = ohneMapping(peer.trim());
	if (!isIP(ip)) return false;
	const roh = (env.CRM_PROXY_VERTRAUEN ?? '').trim();
	const regeln = (roh === '' ? ['privat'] : roh.split(',')).map((s) => s.trim()).filter(Boolean).flatMap((r) => (r === 'privat' ? PRIVAT : [r]));
	return regeln.some((r) => passt(ip, r));
}

/** IP aus Verbindung + Kopfzeile (siehe oben); `unbekannt`, wenn nichts Brauchbares da ist. */
export function besucherIp(peer: string | null, kopfzeilen: Headers | null, env: Record<string, string | undefined> = process.env): string {
	const verbindung = peer ? ohneMapping(peer.trim()) : '';
	const kopf = (env.CRM_ADRESS_KOPF ?? '').trim();
	if (kopf && kopfzeilen && verbindung && vertrauterProxy(verbindung, env)) {
		const werte = (kopfzeilen.get(kopf) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
		const tiefe = Math.max(1, Math.min(10, Number(env.CRM_ADRESS_TIEFE ?? '1') || 1));
		const w = werte.length >= tiefe ? ohneMapping(werte[werte.length - tiefe]) : '';
		if (isIP(w)) return w;
	}
	return verbindung && isIP(verbindung) ? verbindung : 'unbekannt';
}
