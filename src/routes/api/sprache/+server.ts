import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { leseAufnahme } from '$lib/server/sprache/audio';
import { pruefeSprachZugang, vorschlagAusText } from '$lib/server/sprache/befehl';
import { transkribiere } from '$lib/server/sprache/stt';

/**
 * Sprachbefehl als Aufnahme: `POST /api/sprache` mit den rohen Audio-Bytes als Körper und dem Format als
 * Content-Type (webm/opus, ogg/opus, mp4/aac, wav; höchstens 5 MB, 60 s). Reihenfolge der Prüfungen: angemeldet,
 * Modul `sprache`, Recht `sprache.nutzen`, Größe, Format, Magic Bytes – erst dann geht die Aufnahme an den STT-Dienst, erst mit erkanntem
 * Text an die KI (zählt gegen das Kontingent). Antwort `{ text, vorschlag, karte }`; die Aufnahme wird nirgends
 * gespeichert.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await pruefeSprachZugang(locals);
		const aufnahme = await leseAufnahme(request);
		const { text } = await transkribiere(aufnahme.bytes, aufnahme.typ);
		return json(await vorschlagAusText(locals, text));
	} catch (e) {
		return alsAntwort(e);
	}
};
