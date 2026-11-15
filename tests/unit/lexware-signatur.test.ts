import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LEXWARE_OEFFENTLICH, pruefeSignatur } from '../../src/lib/server/lexware/ereignis';

/** Webhook-Signatur X-Lxo-Signature: base64(RSA-SHA512 über den JSON-Body) – Doku „Event Subscriptions“. */
const paar = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fremd = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = paar.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signiere = (text: string, schluessel = paar.privateKey) => createSign('RSA-SHA512').update(text).sign(schluessel).toString('base64');
const body = '{"organizationId":"aa93e8a8-2aa3-470b-b914-caad8a255dd8","eventType":"contact.changed","resourceId":"4d43ad14-671d-4e0c-fd4b-2fd8cc117eff","eventDate":"2023-04-11T12:30:00.000+02:00"}';

describe('Lexware-Webhook-Signatur', () => {
	it('gültige Signatur → ja', () => {
		expect(pruefeSignatur(body, signiere(body), pem)).toBe(true);
	});
	it('veränderter Body, fehlende, kaputte oder fremde Signatur → nein', () => {
		const sig = signiere(body);
		expect(pruefeSignatur(body.replace('contact.changed', 'contact.deleted'), sig, pem)).toBe(false);
		expect(pruefeSignatur(body, null, pem)).toBe(false);
		expect(pruefeSignatur(body, '', pem)).toBe(false);
		expect(pruefeSignatur(body, 'nicht base64 !!', pem)).toBe(false);
		expect(pruefeSignatur(body, signiere(body, fremd.privateKey), pem)).toBe(false);
	});
	it('umformatierter Body (Leerzeichen/Zeilen) wird kompakt geprüft', () => {
		const huebsch = JSON.stringify(JSON.parse(body), null, 2);
		expect(pruefeSignatur(huebsch, signiere(body), pem)).toBe(true);
	});
	it('Standard ist der öffentliche Schlüssel aus der Lexware-Doku (RSA 4096)', () => {
		expect(LEXWARE_OEFFENTLICH).toContain('BEGIN PUBLIC KEY');
		expect(pruefeSignatur(body, signiere(body))).toBe(false);
	});
});
