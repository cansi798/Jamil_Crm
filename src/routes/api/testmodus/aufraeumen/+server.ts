import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testmodusAktiv } from '$lib/server/auth/testmodus';
import { buchungZugriff } from '$lib/server/buchung';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { raeumeTestdatenAuf } from '$lib/server/testdaten';

/**
 * Nur im Testmodus (`CRM_TESTMODUS=1`): Browser-Tests räumen hier am Ende – auch nach einem Fehler – alles weg, was
 * sie angelegt haben (`{ kennung }` des Laufs, siehe `src/lib/server/testdaten.ts`). Ohne Testmodus gibt es die
 * Adresse nicht (404). Recht wie bei den Terminarten.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!testmodusAktiv()) error(404, 'Nicht gefunden');
	try {
		await buchungZugriff(locals);
		const { kennung } = (await leseJson(request)) as { kennung?: unknown };
		return json(await raeumeTestdatenAuf(betriebKontext(locals), kennung));
	} catch (e) {
		return alsAntwort(e);
	}
};
