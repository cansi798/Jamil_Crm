import type { RequestHandler } from './$types';
import { nimmEreignisAn } from '$lib/server/lexware/ereignis';

/**
 * Rückmeldungen von Lexware (Webhook, öffentlich – ohne Anmeldung, geschützt durch die Signatur X-Lxo-Signature).
 * Antwortet sofort (Lexware wartet höchstens 5 s); verarbeitet wird im Hintergrund-Dienst. Die Antwort verrät nichts
 * darüber, ob die Organisation bekannt ist.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const roh = await request.text();
		const a = await nimmEreignisAn(roh, request.headers.get('x-lxo-signature'));
		return new Response(null, { status: a.status });
	} catch (e) {
		console.error('Lexware-Rückmeldung:', (e as Error).message);
		return new Response(null, { status: 500 });
	}
};

/** Lexware prüft die Callback-Adresse beim Anlegen eines Abos per HEAD. */
export const HEAD: RequestHandler = async () => new Response(null, { status: 200 });
