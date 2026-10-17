import { ApiFehler } from '../fehler';
import { MELDUNG_NICHTS, MELDUNG_ZU_GROSS } from './audio';

/**
 * Client zum STT-Dienst `crm-stt` (faster-whisper im internen Netz der Sandbox, siehe stt/README.md). Adresse aus
 * `CRM_STT_URL` (Standard `http://crm-stt:8080`). Die Aufnahme geht als multipart (Feld `audio`) hin und wird dort
 * nur im Arbeitsspeicher verarbeitet; hier wird sie weder gespeichert noch geloggt.
 */

export const STT_TIMEOUT_MS = 90_000;
const NICHT_ERREICHBAR = 'Die Spracherkennung ist gerade nicht erreichbar – bitte gleich noch einmal.';

export function sttUrl(): string {
	const wert = process.env.CRM_STT_URL;
	return (wert && wert.trim() !== '' ? wert.trim() : 'http://crm-stt:8080').replace(/\/+$/, '');
}

/**
 * Wandelt die Aufnahme in Text. Fehler als `ApiFehler` mit deutscher Meldung: 413 zu groß, 422 zu lang/unlesbar/leer
 * (auch: nur Stille → leerer Text), 503 Dienst ausgelastet/nicht erreichbar/Zeitüberschreitung.
 */
export async function transkribiere(audio: Uint8Array, typ: string): Promise<{ text: string; dauerS: number | null }> {
	const form = new FormData();
	form.append('audio', new Blob([audio as BlobPart], { type: typ }), 'aufnahme');
	let antwort: Response;
	try {
		antwort = await fetch(`${sttUrl()}/transkribiere`, {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(STT_TIMEOUT_MS)
		});
	} catch (e) {
		if (e instanceof DOMException && e.name === 'TimeoutError') {
			throw new ApiFehler(503, 'Die Spracherkennung hat zu lange gebraucht – bitte kürzer sprechen oder noch einmal versuchen.');
		}
		throw new ApiFehler(503, NICHT_ERREICHBAR);
	}
	let koerper: Record<string, unknown> = {};
	try {
		koerper = (await antwort.json()) as Record<string, unknown>;
	} catch {
		koerper = {};
	}
	if (antwort.status === 413) throw new ApiFehler(413, MELDUNG_ZU_GROSS);
	if (antwort.status === 422) {
		if (koerper.grund === 'zu_lang') throw new ApiFehler(422, 'Die Aufnahme ist zu lang (höchstens 60 Sekunden).');
		if (koerper.grund === 'unlesbar') throw new ApiFehler(422, 'Die Aufnahme konnte nicht gelesen werden – bitte noch einmal.');
		throw new ApiFehler(422, MELDUNG_NICHTS);
	}
	if (!antwort.ok || typeof koerper.text !== 'string') throw new ApiFehler(503, NICHT_ERREICHBAR);
	const text = koerper.text.replace(/\s+/g, ' ').trim();
	if (text === '') throw new ApiFehler(422, MELDUNG_NICHTS);
	return { text, dauerS: typeof koerper.dauer_s === 'number' ? koerper.dauer_s : null };
}
