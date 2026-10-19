import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { ohnePreise } from '$lib/server/preisschutz';
import { katalogAendern, katalogLesen, legePositionAn, listeKatalog } from '$lib/server/katalog';

/**
 * Leistungskatalog: `GET /api/katalog?suche=&gewerk=&nurAktive=1` (Modul `katalog`, Recht `katalog.bearbeiten` oder
 * `angebote.bearbeiten`; Preisfelder nur mit `preise.sehen`). `POST` legt eine Position an (`katalog.bearbeiten`;
 * Beträge `lohn`/`material` in Euro, z. B. „1.234,56“ – nur mit `preise.sehen`).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const { mitPreisen } = await katalogLesen(locals);
		const liste = await listeKatalog(
			betriebKontext(locals),
			{
				suche: url.searchParams.get('suche') ?? undefined,
				gewerk: url.searchParams.get('gewerk') ?? undefined,
				nurAktive: url.searchParams.get('nurAktive') === '1'
			},
			mitPreisen
		);
		// Sicherheitsnetz (Preisschutz): ohne `preise.sehen` nie Preisfelder
		return json(mitPreisen ? liste : ohnePreise(liste));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const { mitPreisen } = await katalogAendern(locals);
		const p = await legePositionAn(betriebKontext(locals), await leseJson(request), mitPreisen);
		return json(mitPreisen ? p : ohnePreise(p), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
