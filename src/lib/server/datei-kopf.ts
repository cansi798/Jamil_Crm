/**
 * Sichere Kopfzeilen für gespeicherte Dateien (Uploads, Logos, Fotos), die vom App-Ursprung ausgeliefert werden.
 * Schutz gegen gespeichertes XSS: Inline angezeigt werden nur Rasterbilder (PNG, JPEG, WebP) und PDF – alles andere
 * (SVG, HTML, unbekannt) geht als `application/octet-stream` zum Herunterladen. Immer `nosniff`, außer bei PDF eine
 * CSP mit `sandbox` (selbst wenn ein Browser etwas doch als Dokument öffnet, läuft kein Skript im Ursprung der App).
 */

export const RASTERBILD = /^image\/(png|jpeg|webp)$/;
const ANZEIGBAR = /^(image\/(png|jpeg|webp)|application\/pdf)$/;
export const DATEI_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

export function dateiName(art: 'inline' | 'attachment', name: string): string {
	const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	return `${art}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function sichereDateiKopfzeilen(typ: string, opts: { name?: string; art?: 'inline' | 'attachment' } = {}): Record<string, string> {
	const anzeigbar = ANZEIGBAR.test(typ);
	const art = anzeigbar ? (opts.art ?? 'inline') : 'attachment';
	return {
		'content-type': anzeigbar ? typ : 'application/octet-stream',
		'content-disposition': opts.name ? dateiName(art, opts.name) : art,
		'x-content-type-options': 'nosniff',
		// PDF: der eingebaute Betrachter läuft in einer sandbox-CSP nicht (Chrome blockiert) – PDF führt im Ursprung
		// der App ohnehin kein Skript aus; alle anderen bekommen die strenge CSP
		...(typ === 'application/pdf' ? {} : { 'content-security-policy': DATEI_CSP })
	};
}
