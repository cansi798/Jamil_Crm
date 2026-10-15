import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfProtokollLesen, liesProtokoll, pruefeSuche } from '$lib/server/protokoll';

/**
 * Änderungsverlauf eines Datensatzes: `GET /api/protokoll?tabelle=rollen&datensatz=<uuid>[&vor=<id>]`.
 * Antwort `{ eintraege, naechsteVor }` – 50 Einträge, neueste zuerst; `naechsteVor` für die nächste Seite (sonst null).
 * Lesen darf, wer `einstellungen` hat oder das Leserecht der Tabelle (siehe `PROTOKOLL_TABELLEN`).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		if (!locals.nutzer) throw new ApiFehler(401, 'Nicht angemeldet');
		const k = betriebKontext(locals);
		const suche = pruefeSuche(url.searchParams);
		if (!darfProtokollLesen(locals.nutzer, suche.tabelle)) throw new ApiFehler(403, 'Keine Berechtigung');
		return json(await liesProtokoll(k, suche));
	} catch (e) {
		return alsAntwort(e);
	}
};
