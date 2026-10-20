import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nextcloud } from '$lib/server/nextcloud/konfig';
import { FLOW_COOKIE, FLOW_PFAD, FLOW_SEKUNDEN, flowCookieWert, startAdresse } from '$lib/server/nextcloud/oidc';
import { ssoBegrenzung } from '$lib/server/nextcloud/begrenzung';
import { ipVon } from '$lib/server/buchung-anfrage';

/** „Mit Nextcloud anmelden“ – Start: state/nonce/PKCE-Verifier ins kurzlebige Cookie, dann zu Nextcloud. */
export const GET: RequestHandler = async (event) => {
	const { url, cookies } = event;
	const k = nextcloud();
	if (!k?.anmeldung) error(404, 'Nicht gefunden');
	if (event.locals.nutzer) redirect(303, '/');
	if (!ssoBegrenzung.pruefeVersuch(`start:${ipVon(event)}`).erlaubt) {
		redirect(303, '/anmelden?hinweis=nextcloud-zu-oft');
	}
	let ziel: string;
	try {
		const { adresse, flow } = await startAdresse(k, `${url.origin}${FLOW_PFAD}/rueckruf`);
		cookies.set(FLOW_COOKIE, flowCookieWert(flow), {
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: FLOW_PFAD,
			maxAge: FLOW_SEKUNDEN
		});
		ziel = adresse;
	} catch (e) {
		console.error('Nextcloud-Anmeldung (Start):', (e as Error).message);
		redirect(303, '/anmelden?hinweis=nextcloud-fehler');
	}
	redirect(303, ziel);
};
