import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, ladePdfDaten } from '$lib/server/angebote';
import { holeLogo, holeProfil } from '$lib/server/betriebsprofil';
import { angebotPdf } from '$lib/server/pdf/angebot-pdf';

/**
 * Angebot als PDF (A4, Briefkopf und Logo des Betriebs) zum Herunterladen: `Angebot_AN-2026-0001.pdf`.
 * Auch mit Warnung „Preis fehlt“ – die Oberfläche fragt vorher nach. Rechte wie alle Angebots-Endpunkte.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await angeboteZugriff(locals);
		const k = betriebKontext(locals);
		const daten = await ladePdfDaten(k, params.id);
		const [profil, logo] = await Promise.all([holeProfil(k), holeLogo(k)]);
		const pdf = await angebotPdf({ profil, logo, ...daten });
		const datei = `Angebot_${daten.angebot.nummer.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
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
