import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { laufend, pruefeStempelAktion, stempeln, zeitZugriff } from '$lib/server/zeiterfassung';

/** Laufende Zeit des angemeldeten Nutzers (Anzeige oben, Knöpfe). */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const z = await zeitZugriff(locals);
		return json({ laufend: await laufend(z.k, z.nutzer.id) });
	} catch (e) {
		return alsAntwort(e);
	}
};

/**
 * Ein Tipp der Zeiterfassung: `{ aktion: start|pause|weiter|fertig|abfahrt|angekommen, auftragId?, taetigkeitId? }`.
 * Recht `zeiten.erfassen` (oder `zeiten.verwalten`), Modul `zeiterfassung`; Auftrag muss sichtbar sein.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const z = await zeitZugriff(locals);
		const e = await leseJson(request);
		const r = await stempeln(z, pruefeStempelAktion(e.aktion), {
			auftragId: typeof e.auftragId === 'string' ? e.auftragId : null,
			taetigkeitId: typeof e.taetigkeitId === 'string' ? e.taetigkeitId : null
		});
		return json(r);
	} catch (e) {
		return alsAntwort(e);
	}
};
