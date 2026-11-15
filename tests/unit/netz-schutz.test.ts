import { describe, expect, it } from 'vitest';
import { istOeffentlicheIp, pruefeSmtpHost, SMTP_PORTS } from '../../src/lib/server/netz-schutz';

const aufloeser = (tabelle: Record<string, string[]>) => async (host: string) => {
	const a = tabelle[host];
	if (!a) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
	return a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

describe('Schutz vor Zugriffen ins interne Netz (SSRF)', () => {
	it('private, interne und Sonderadressen sind nicht öffentlich', () => {
		for (const ip of ['127.0.0.1', '127.5.5.5', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.1'])
			expect(istOeffentlicheIp(ip), ip).toBe(false);
		for (const ip of ['212.227.15.183', '8.8.8.8', '172.32.0.1', '2a01:238:20a:202:1000::1'])
			expect(istOeffentlicheIp(ip), ip).toBe(true);
		expect(istOeffentlicheIp('kein-ip')).toBe(false);
	});

	it('Hostname: ALLE Adressen müssen öffentlich sein; Ergebnis ist die geprüfte IP', async () => {
		const r = aufloeser({ 'smtp.ionos.de': ['212.227.15.183'], 'gemischt.test': ['212.227.15.183', '10.0.0.5'], 'crm-db': ['172.18.0.3'], 'meta.test': ['169.254.169.254'], 'v6.test': ['::1'] });
		expect(await pruefeSmtpHost('smtp.ionos.de', 587, r)).toEqual({ ip: '212.227.15.183', servername: 'smtp.ionos.de' });
		for (const h of ['gemischt.test', 'crm-db', 'meta.test', 'v6.test'])
			await expect(pruefeSmtpHost(h, 587, r), h).rejects.toMatchObject({ status: 400 });
		await expect(pruefeSmtpHost('gibtsnicht.test', 587, r)).rejects.toMatchObject({ status: 400 });
	});

	it('IP direkt eingegeben: nur öffentlich; Ports nur 25/465/587/2525', async () => {
		const r = aufloeser({});
		expect(await pruefeSmtpHost('212.227.15.183', 465, r)).toEqual({ ip: '212.227.15.183', servername: null });
		await expect(pruefeSmtpHost('127.0.0.1', 587, r)).rejects.toMatchObject({ status: 400 });
		await expect(pruefeSmtpHost('[::1]', 587, r)).rejects.toMatchObject({ status: 400 });
		expect([...SMTP_PORTS]).toEqual([25, 465, 587, 2525]);
		await expect(pruefeSmtpHost('212.227.15.183', 5432, r)).rejects.toMatchObject({ status: 400 });
	});

	it('DNS-Rebinding: jede Prüfung löst neu auf (erst öffentlich, dann intern → abgelehnt)', async () => {
		let n = 0;
		const wechselnd = async () => [{ address: n++ === 0 ? '212.227.15.183' : '127.0.0.1', family: 4 }];
		expect((await pruefeSmtpHost('wechsel.test', 587, wechselnd)).ip).toBe('212.227.15.183');
		await expect(pruefeSmtpHost('wechsel.test', 587, wechselnd)).rejects.toMatchObject({ status: 400 });
	});
});
