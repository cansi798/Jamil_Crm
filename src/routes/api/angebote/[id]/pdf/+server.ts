import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, ladePdfDaten } from '$lib/server/angebote';
import { holeLogo, holeProfil } from '$lib/server/betriebsprofil';
import { angebotPdf } from '$lib/server/pdf/angebot-pdf';
import { lexwareAngebotPdf } from '$lib/server/lexware/angebote';

/**
 * Angebot als PDF (A4, Briefkopf und Logo des Betriebs) zum Herunterladen: `Angebot_AN-2026-0001.pdf`.
 * Auch mit Warnung „Preis fehlt“ – die Oberfläche fragt vorher nach. Rechte wie alle Angebots-Endpunkte.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const k = betriebKontext(locals);
		const daten = await ladePdfDaten(k, params.id, zg);
		// Lexware-Betrieb: festgeschriebenes Angebot → PDF aus Lexware; vorher nur eine interne Vorschau mit Wasserzeichen
		const lx = daten.angebot.lexware?.id ? await lexwareAngebotPdf(k, params.id, zg) : null;
		const [profil, logo] = lx ? [null, null] : await Promise.all([holeProfil(k), holeLogo(k)]);
		const pdf = lx
			? lx.bytes
			: await angebotPdf({ profil: profil!, logo, ...daten, wasserzeichen: daten.angebot.belegQuelle === 'lexware' ? 'Vorschau – kein Beleg' : undefined });
		const datei = lx ? lx.name : `Angebot_${daten.angebot.nummer.replace(/[^A-Za-z0-9-]/g, '_')}${daten.angebot.belegQuelle === 'lexware' ? '_Vorschau' : ''}.pdf`;
		return new Response(pdf as BodyInit, {
			headers: {
				'content-type': 'application/pdf',
				'content-disposition': `attachment; filename="${datei}"`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
