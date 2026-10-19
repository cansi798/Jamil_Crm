import { createServer, type Server } from 'node:http';

/**
 * Test-Doppel für den STT-Dienst crm-stt: kleiner HTTP-Server auf 127.0.0.1 (freier Port), der jede
 * `POST /transkribiere` zählt und die eingestellte Antwort liefert. `CRM_STT_URL` zeigt im Test darauf.
 */
export type SttDouble = {
	url: string;
	/** Anzahl der empfangenen Anfragen an /transkribiere. */
	aufrufe: () => number;
	/** Größe des zuletzt empfangenen Körpers (Bytes, inkl. multipart-Hülle). */
	letzteGroesse: () => number;
	antworte: (status: number, koerper: Record<string, unknown>) => void;
	/** Nächste Antworten erst nach `ms` Millisekunden (Timeout-Tests). */
	verzoegere: (ms: number) => void;
	zuruecksetzen: () => void;
	stop: () => Promise<void>;
};

export async function starteSttDouble(): Promise<SttDouble> {
	let anzahl = 0;
	let groesse = 0;
	let status = 200;
	let koerper: Record<string, unknown> = { text: 'Neuer Auftrag für Müller', dauer_s: 2.1, sprache: 'de' };
	let verzoegerung = 0;
	const server: Server = createServer((req, res) => {
		const teile: Buffer[] = [];
		req.on('data', (d: Buffer) => teile.push(d));
		req.on('end', () => {
			if (req.url === '/transkribiere' && req.method === 'POST') {
				anzahl++;
				groesse = teile.reduce((s, t) => s + t.length, 0);
			}
			setTimeout(() => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(koerper));
			}, verzoegerung);
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	const adresse = server.address();
	if (!adresse || typeof adresse === 'string') throw new Error('STT-Double ohne Port');
	return {
		url: `http://127.0.0.1:${adresse.port}`,
		aufrufe: () => anzahl,
		letzteGroesse: () => groesse,
		antworte: (s, k) => {
			status = s;
			koerper = k;
		},
		verzoegere: (ms) => {
			verzoegerung = ms;
		},
		zuruecksetzen: () => {
			anzahl = 0;
			groesse = 0;
			status = 200;
			koerper = { text: 'Neuer Auftrag für Müller', dauer_s: 2.1, sprache: 'de' };
			verzoegerung = 0;
		},
		stop: () =>
			new Promise<void>((ok) => {
				server.closeAllConnections();
				server.close(() => ok());
			})
	};
}

/** Minimale gültige Kopf-Bytes je Format (für Signaturprüfungen; der Rest ist egal, das Doppel dekodiert nicht). */
export const AUDIO_KOPF = {
	webm: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]),
	ogg: new TextEncoder().encode('OggS\u0000\u0002\u0000\u0000\u0000\u0000\u0000\u0000'),
	mp4: new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
	wav: new TextEncoder().encode('RIFF$\u0000\u0000\u0000WAVEfmt ')
} as const;

/** Kopf + Füllbytes auf `groesse` Bytes. */
export function audioBytes(format: keyof typeof AUDIO_KOPF, groesse = 2048): Uint8Array {
	const b = new Uint8Array(Math.max(groesse, AUDIO_KOPF[format].length));
	b.set(AUDIO_KOPF[format]);
	return b;
}
