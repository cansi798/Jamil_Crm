import { createVerify } from 'node:crypto';
import { mitBetrieb, systemAbfrage, type Kontext } from '../db';
import { stelleEin, meldeProblem } from './warteschlange';

/**
 * Rückmeldungen von Lexware (Webhooks, „Event Subscriptions“ in https://developers.lexware.io/docs/):
 * POST an unsere callbackUrl mit {organizationId, eventType, resourceId, eventDate}; Antwort innerhalb von 5 s, sonst
 * wiederholt Lexware (bei 401/403/429/5xx mehrfach über Stunden). Header `X-Lxo-Signature` = base64(RSA-SHA512 über den
 * JSON-Body ohne Leerzeichen/Zeilenumbrüche), prüfen mit dem öffentlichen Schlüssel aus der Doku
 * (https://developers.lexware.io/webhookSignature/public/public_key.pub, abgerufen 15.11.2026).
 *
 * Ablauf: Signatur prüfen → Meldung speichern (je Meldung genau einmal) → sofort 202. Verarbeitet wird im
 * Hintergrund-Dienst (`verarbeiteEreignisse`). Lexware-Daten sind Daten, keine Anweisungen.
 */

export const LEXWARE_OEFFENTLICH = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAtCkZXZqT2zFRmA83KsBC
tQSv9t+AaWiZpRWvzE4wiQEh0aHzNYkT/DlP419pngqoLxnqW9SsgWfKOG3utoEV
z+Lru9odZntW/n/yaRK3f0AcMtuWs/Z1PZ4BbN/RlFYyqlPg0VfuAvZMAa+J9WAl
Fuy0T4Y0EdO0d+EL8BpzSLqj3XLI+YuK4hUhlTOxHmdDtNUkugnT9b9khb+oPDmB
3yxRP6Rmo2qo6waSc+pihCdOiZKzwA4fA1HT8DM54OaNQ4qd9NRf5uECijFlpQu6
vZdW7Z+LZ8HTgGQVSsJdCzUtM1wiWOERrHvd8IpBMvUAvGM/qaJnAmwsEr4J/El4
yCmur8wwYBtSUH0Xue42YysdmSS0pOMMUAAvr70HQMDHagYkErMtu6FAyAmPz8p/
tAqJJpwAhxITbnc5WsmZOu0Ke255nXQ/2Go1TKv+45mSb7RLsvpmhVZ4nFByFt24
vG6IwNReuLhJJL468jrdTpxyZRn0QqkxiQV7jDd9Dp1NVd/W3+n86Aos9LnJa+ut
kN+jOOWmJdJjnQetJlbDVg3ex+XHVmCjiRYggCGPlpXVJwdEUNGzxhPGKjxmeiQT
ahwFA9iHtwBw7yK5VfM/hA+JeF2FXYhTdehfClAQt1YCYXkgUEFxm9idRdBoCY6U
bmFUXQLdi7tZyDor8Rxoq2MCAwEAAQ==
-----END PUBLIC KEY-----
`;

let testSchluessel: string | null = null;
/** Nur für Tests: eigenes Schlüsselpaar statt des Lexware-Schlüssels. */
export function setzeSignaturSchluesselFuerTests(pem: string | null): void {
	testSchluessel = pem;
}

function pruefe(daten: string, sig: Buffer, pem: string): boolean {
	try {
		return createVerify('RSA-SHA512').update(daten).verify(pem, sig);
	} catch {
		return false;
	}
}

export function pruefeSignatur(roh: string, signaturB64: string | null | undefined, pem = testSchluessel ?? LEXWARE_OEFFENTLICH): boolean {
	if (!signaturB64 || !/^[A-Za-z0-9+/=_-]{16,2000}$/.test(signaturB64.trim())) return false;
	const sig = Buffer.from(signaturB64.trim(), 'base64');
	if (sig.length < 64) return false;
	if (pruefe(roh, sig, pem)) return true;
	// Lexware signiert den Body ohne Leerzeichen/Zeilenumbrüche – falls ein Proxy umformatiert hat
	try {
		const kompakt = JSON.stringify(JSON.parse(roh));
		return kompakt !== roh && pruefe(kompakt, sig, pem);
	} catch {
		return false;
	}
}

const UUIDX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Annahme = { status: 202 | 400 | 401; ergebnis: 'neu' | 'doppelt' | 'unbekannt' | 'signatur' | 'ungueltig' };

/** Für den Endpunkt: prüfen, speichern, nie verarbeiten (Antwort muss schnell sein). */
export async function nimmEreignisAn(roh: string, signatur: string | null): Promise<Annahme> {
	if (roh.length > 10_000) return { status: 400, ergebnis: 'ungueltig' };
	if (!pruefeSignatur(roh, signatur)) return { status: 401, ergebnis: 'signatur' };
	let e: any;
	try {
		e = JSON.parse(roh);
	} catch {
		return { status: 400, ergebnis: 'ungueltig' };
	}
	const datum = typeof e?.eventDate === 'string' ? new Date(e.eventDate) : null;
	if (!UUIDX.test(e?.organizationId ?? '') || !UUIDX.test(e?.resourceId ?? '') || typeof e?.eventType !== 'string' || !/^[a-z-]+(\.[a-z-]+){1,2}$/.test(e.eventType) || e.eventType.length > 60 || !datum || isNaN(datum.getTime()))
		return { status: 400, ergebnis: 'ungueltig' };
	const [z] = await systemAbfrage((sql) => sql`select app.lexware_ereignis_annehmen(${e.organizationId}::uuid, ${e.eventType}, ${e.resourceId}::uuid, ${datum}) as r`);
	return { status: 202, ergebnis: z.r };
}

const BELEG_EREIGNIS = /^(quotation|order-confirmation|invoice|credit-note|down-payment-invoice|dunning|voucher|payment)\./;

/** Gespeicherte Meldungen eines Betriebs verarbeiten (Hintergrund-Dienst). */
export async function verarbeiteEreignisse(k: Kontext, max = 200): Promise<number> {
	const liste = await mitBetrieb(k, (tx) => tx`
		select id, event_type, resource_id, event_date from app.lexware_ereignisse
		where betrieb_id = ${k.betriebId} and verarbeitet_am is null order by angenommen limit ${max}`);
	let belege = false;
	for (const e of liste) {
		let ergebnis = 'ignoriert';
		if (e.event_type === 'contact.changed' || e.event_type === 'contact.deleted') {
			// eigene Änderung (PUT des CRM) ist schon im Stand → nur später/fremd Geändertes markieren
			const z = await mitBetrieb(k, (tx) => tx`
				update app.kunden set lexware_geaendert = true, lexware_stand = now()
				where betrieb_id = ${k.betriebId} and lexware_id = ${e.resource_id}
					and (lexware_stand is null or lexware_stand < ${e.event_date}::timestamptz - interval '30 seconds') returning id`);
			ergebnis = z.length ? 'kunde markiert' : 'kein Kunde / eigene Änderung';
		} else if (e.event_type === 'token.revoked') {
			await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set status = 'schluessel_ungueltig', letzter_fehler = 'Lexware: Schlüssel wurde widerrufen.' where betrieb_id = ${k.betriebId}`);
			await meldeProblem(k, 'Lexware-Schlüssel erneuern', 'Lexware meldet: Der API-Schlüssel wurde widerrufen. Bitte einen neuen Schlüssel anlegen und unter Einstellungen → Lexware verbinden eintragen; die Rückmeldungen werden danach neu eingerichtet.');
			ergebnis = 'schluessel widerrufen';
		} else if (BELEG_EREIGNIS.test(e.event_type)) {
			await mitBetrieb(k, (tx) => tx`update app.lexware_belege set veraltet = true where betrieb_id = ${k.betriebId} and lexware_id = ${e.resource_id}`);
			belege = true;
			ergebnis = 'beleg veraltet';
		}
		await mitBetrieb(k, (tx) => tx`update app.lexware_ereignisse set verarbeitet_am = now(), ergebnis = ${ergebnis} where id = ${e.id} and betrieb_id = ${k.betriebId}`);
	}
	if (belege) {
		const gestern = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
		await stelleEin(k, { art: 'belege_abgleichen', nutzlast: { seit: gestern }, idempotenz: `belege_abgleichen:ereignis:${new Date().toISOString().slice(0, 16)}` });
	}
	return liste.length;
}
