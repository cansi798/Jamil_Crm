import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { pruefeModul } from '$lib/server/tarif';
import { leseAufnahme } from '$lib/server/sprache/audio';
import { transkribiere } from '$lib/server/sprache/stt';

/**
 * Sprachbefehl als Aufnahme: `POST /api/sprache` mit den rohen Audio-Bytes als Körper und dem Format als
 * Content-Type (webm/opus, ogg/opus, mp4/aac, wav; höchstens 5 MB, 60 s). Reihenfolge der Prüfungen: angemeldet,
 * Modul `sprache`, Größe, Format, Magic Bytes – erst dann geht die Aufnahme an den STT-Dienst. Die Aufnahme wird
 * nirgends gespeichert.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		betriebKontext(locals);
		await pruefeModul(locals, 'sprache');
		const aufnahme = await leseAufnahme(request);
		const { text } = await transkribiere(aufnahme.bytes, aufnahme.typ);
		return json({ text });
	} catch (e) {
		return alsAntwort(e);
	}
};
