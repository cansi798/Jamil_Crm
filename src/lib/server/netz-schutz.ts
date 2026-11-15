import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { ApiFehler } from './fehler';

/**
 * Schutz vor Zugriffen ins interne Netz (SSRF) für frei eingegebene Server (SMTP-Postfach, Sicherheitsprüfung 15.11.).
 * Ein Name gilt nur, wenn ALLE aufgelösten Adressen öffentlich sind; verbunden wird danach zur geprüften IP (TLS mit dem
 * Namen als servername) – so hilft auch kein DNS-Rebinding zwischen Prüfung und Verbindung. Jede Verbindung prüft neu.
 */

const GESPERRT = new BlockList();
for (const [netz, laenge] of [
	['0.0.0.0', 8], // „dieses Netz“
	['10.0.0.0', 8],
	['100.64.0.0', 10], // CGNAT
	['127.0.0.0', 8],
	['169.254.0.0', 16], // Link-Local, Cloud-Metadaten
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4], // Multicast
	['240.0.0.0', 4] // reserviert + Broadcast
] as const)
	GESPERRT.addSubnet(netz, laenge, 'ipv4');
for (const [netz, laenge] of [
	['::', 128],
	['::1', 128],
	['64:ff9b::', 96],
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7], // ULA
	['fe80::', 10], // Link-Local
	['ff00::', 8] // Multicast
] as const)
	GESPERRT.addSubnet(netz, laenge, 'ipv6');

export function istOeffentlicheIp(ip: string): boolean {
	const roh = ip.replace(/^\[|\]$/g, '');
	const art = isIP(roh);
	if (art === 0) return false;
	if (art === 6) {
		const gemappt = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(roh);
		if (gemappt) return istOeffentlicheIp(gemappt[1]);
		return !GESPERRT.check(roh, 'ipv6');
	}
	return !GESPERRT.check(roh, 'ipv4');
}

export const SMTP_PORTS = [25, 465, 587, 2525] as const;

export type Aufloeser = (host: string) => Promise<{ address: string; family: number }[]>;
const standardAufloeser: Aufloeser = (host) => lookup(host, { all: true, verbatim: true });

const NICHT_ERLAUBT = 'Dieser Mailserver ist nicht erlaubt (interne oder private Adresse). Bitte den Server Ihres Mail-Anbieters eintragen, z. B. smtp.ionos.de.';

/** Prüft Server und Port; liefert die geprüfte IP und (bei Namen) den servername fürs TLS-Zertifikat. */
export async function pruefeSmtpHost(host: string, port: number, aufloeser: Aufloeser = standardAufloeser): Promise<{ ip: string; servername: string | null }> {
	if (!(SMTP_PORTS as readonly number[]).includes(port)) throw new ApiFehler(400, 'Port: erlaubt sind 587 (empfohlen), 465, 25 oder 2525.');
	const roh = host.trim().replace(/^\[|\]$/g, '');
	if (isIP(roh)) {
		if (!istOeffentlicheIp(roh)) throw new ApiFehler(400, NICHT_ERLAUBT);
		return { ip: roh, servername: null };
	}
	let adressen: { address: string }[];
	try {
		adressen = await aufloeser(roh);
	} catch {
		throw new ApiFehler(400, 'Der Mailserver wurde nicht gefunden – bitte den Namen prüfen.');
	}
	if (adressen.length === 0 || !adressen.every((a) => istOeffentlicheIp(a.address))) throw new ApiFehler(400, NICHT_ERLAUBT);
	return { ip: adressen[0].address, servername: roh };
}
