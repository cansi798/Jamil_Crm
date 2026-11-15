import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, setzeAngebotStatus } from '$lib/server/angebote';

/**
 * Statuswechsel `{ status, termin?, wunsch? }` mit Kopplung an den Auftrag (versendet: Anfrage → Angebot, angenommen:
 * Angebot → Beauftragt). Bei Lexware-Betrieben schreibt „versendet“ das Angebot in Lexware fest (Warteschlange);
 * `termin` (Vorschlag 1–3, ID oder „keiner“) wählt bei der Annahme den Baubeginn.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { status, termin, wunsch } = await leseJson(request);
		return json(await setzeAngebotStatus(betriebKontext(locals), params.id, status, zg, 'oberflaeche', { termin, wunsch }));
	} catch (e) {
		return alsAntwort(e);
	}
};
