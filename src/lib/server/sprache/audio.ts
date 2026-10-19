import { ApiFehler } from '../fehler';

/**
 * Prüfung einer Sprachaufnahme vor der Spracherkennung (Stufe 1d): höchstens 5 MB, Format nur webm/opus,
 * ogg/opus, mp4/aac oder wav – erkannt am Content-Type UND an den ersten Bytes (Magic Bytes). Erst wenn alles
 * passt, geht die Aufnahme an den STT-Dienst.
 */

export const AUDIO_MAX_BYTES = 5 * 1024 * 1024;

export type AudioFormat = 'webm' | 'ogg' | 'mp4' | 'wav';

/** Content-Types (ohne Parameter) der MediaRecorder von Chrome/Firefox/Safari und gängiger Dateien. */
const TYPEN: Record<string, AudioFormat> = {
	'audio/webm': 'webm',
	'video/webm': 'webm',
	'audio/ogg': 'ogg',
	'application/ogg': 'ogg',
	'audio/opus': 'ogg',
	'audio/mp4': 'mp4',
	'video/mp4': 'mp4',
	'audio/x-m4a': 'mp4',
	'audio/m4a': 'mp4',
	'audio/aac': 'mp4',
	'audio/wav': 'wav',
	'audio/wave': 'wav',
	'audio/x-wav': 'wav',
	'audio/vnd.wave': 'wav'
};

export const MELDUNG_FORMAT = 'Dieses Audioformat wird nicht unterstützt (webm, ogg, mp4, wav).';
export const MELDUNG_ZU_GROSS = 'Die Aufnahme ist zu groß (höchstens 5 MB).';
export const MELDUNG_NICHTS = 'Ich habe nichts verstanden – bitte noch einmal';
export const MELDUNG_KEINE_AUFNAHME = 'Die Datei ist keine gültige Aufnahme.';

/** Format aus dem Content-Type (Parameter wie `;codecs=opus` erlaubt), sonst `null`. */
export function formatAusTyp(typ: string | null | undefined): AudioFormat | null {
	const basis = (typ ?? '').split(';')[0].trim().toLowerCase();
	return Object.hasOwn(TYPEN, basis) ? TYPEN[basis] : null;
}

const gleich = (b: Uint8Array, ab: number, erwartet: readonly number[]) =>
	b.length >= ab + erwartet.length && erwartet.every((x, i) => b[ab + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Passen die ersten Bytes zum Format? webm `1A45DFA3`, ogg `OggS`, mp4 `ftyp` ab Byte 4, wav `RIFF…WAVE`. */
export function passtSignatur(b: Uint8Array, format: AudioFormat): boolean {
	switch (format) {
		case 'webm':
			return gleich(b, 0, [0x1a, 0x45, 0xdf, 0xa3]);
		case 'ogg':
			return gleich(b, 0, ascii('OggS'));
		case 'mp4':
			return gleich(b, 4, ascii('ftyp'));
		case 'wav':
			return gleich(b, 0, ascii('RIFF')) && gleich(b, 8, ascii('WAVE'));
	}
}

/**
 * Liest die Aufnahme aus der Anfrage (roher Körper) und prüft sie: 413 über 5 MB (zuerst am Content-Length-Kopf,
 * ohne den Körper zu lesen), 415 bei fremdem Format, 422 bei leerer Aufnahme, 400 wenn die Bytes nicht zum Format
 * passen. Liefert Bytes, Format und den Content-Type für den STT-Dienst.
 */
export async function leseAufnahme(request: Request): Promise<{ bytes: Uint8Array; format: AudioFormat; typ: string }> {
	const laenge = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(laenge) && laenge > AUDIO_MAX_BYTES) throw new ApiFehler(413, MELDUNG_ZU_GROSS);
	const typ = request.headers.get('content-type');
	const format = formatAusTyp(typ);
	if (!format) throw new ApiFehler(415, MELDUNG_FORMAT);
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await request.arrayBuffer());
	} catch {
		throw new ApiFehler(400, 'Ungültige Anfrage.');
	}
	if (bytes.byteLength > AUDIO_MAX_BYTES) throw new ApiFehler(413, MELDUNG_ZU_GROSS);
	if (bytes.byteLength === 0) throw new ApiFehler(422, MELDUNG_NICHTS);
	if (!passtSignatur(bytes, format)) throw new ApiFehler(400, MELDUNG_KEINE_AUFNAHME);
	return { bytes, format, typ: (typ ?? '').split(';')[0].trim().toLowerCase() };
}
