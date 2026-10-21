import type { RequestHandler } from './$types';
import { RASTERBILD, sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { holeLogo } from '$lib/server/betriebsprofil';

/**
 * Logo des eigenen Betriebs für die App-Marke oben links (Wunsch Jamil, msg 3014). Jeder angemeldete Benutzer des
 * Betriebs darf es sehen (kein vertraulicher Inhalt). `?variante=dunkel` = Variante für dunkle Hintergründe
 * (Seitenleiste), sonst das Briefkopf-Logo. Nur Rasterbilder (nie SVG/HTML vom App-Ursprung – gespeichertes XSS).
 * Der Cache-Brecher `?v=` in der Adresse ändert sich mit jedem Logo-Wechsel.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const n = locals.nutzer;
		if (!n) throw new ApiFehler(401, 'Nicht angemeldet');
		if (!n.betriebId) throw new ApiFehler(404, 'Kein Logo hinterlegt.');
		const logo = await holeLogo(betriebKontext(locals), url.searchParams.get('variante') === 'dunkel' ? 'dunkel' : 'briefkopf');
		if (!logo || !RASTERBILD.test(logo.typ)) throw new ApiFehler(404, 'Kein Logo hinterlegt.');
		return new Response(logo.bytes as BodyInit, {
			headers: { ...sichereDateiKopfzeilen(logo.typ), 'cache-control': 'private, max-age=86400' }
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
