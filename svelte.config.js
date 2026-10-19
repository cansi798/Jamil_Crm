import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			// 6 MB: Audio-Uploads (5 MB) + etwas Platz für JSON-Metadaten
			bodySizeLimit: 6 * 1024 * 1024
		}),
		// Neue Version nach einem Deploy erkennen: alle 60 s fragen (`updated` aus $app/state); der nächste
		// Seitenwechsel lädt dann die neue App-Hülle vollständig (src/routes/+layout.svelte, src/lib/aktualisierung.ts).
		version: { pollInterval: 60_000 },
		// Content-Security-Policy für alle Seiten. `mode: 'auto'`: SvelteKit versieht seine eigenen Inline-Skripte
		// (Start der App, Registrierung des Service Workers) mit einer Nonce je Antwort – sonst laufen nur Skripte
		// vom eigenen Server, nie Inline-Skripte oder eval. Weitere Kopfzeilen für alle Antworten: hooks.server.ts.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self'],
				// Nur Stil-ATTRIBUTE inline (keine <style>-Elemente, keine Skripte): SvelteKits Ansager für Seitenwechsel
				// (#svelte-announcer, versteckt per style="…") und die Hülle in app.html brauchen sie – ohne diese
				// Ausnahme meldet der Browser Verstöße und der Ansager wäre nicht mehr versteckt.
				'style-src-attr': ['unsafe-inline'],
				'img-src': ['self', 'data:'], // QR-Code der Zwei-Faktor-Einrichtung ist ein data:-Bild
				'font-src': ['self'],
				'connect-src': ['self'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
