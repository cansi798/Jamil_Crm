import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nextcloud } from '$lib/server/nextcloud/konfig';
import { discovery, FLOW_COOKIE, FLOW_PFAD, gleich, liesFlowCookie, tauscheCode } from '$lib/server/nextcloud/oidc';
import { meldeUeberNextcloudAn } from '$lib/server/nextcloud/konten';
import { ssoBegrenzung } from '$lib/server/nextcloud/begrenzung';
import { ipVon } from '$lib/server/buchung-anfrage';
import { COOKIE_NAME, loescheSitzung, setzeSitzungsCookie } from '$lib/server/auth/sitzung';
import { loescheVorsitzungsCookie, setzeVorsitzungsCookie, VORSITZUNG_COOKIE } from '$lib/server/auth/vorsitzung';

/**
 * Rückkehr von Nextcloud: state (Cookie) prüfen, iss-Parameter prüfen, Code mit PKCE tauschen, ID-Token prüfen,
 * dann Sitzung bzw. CRM-Zwei-Faktor. Fehler landen als feste Hinweise auf der Anmeldeseite (nie Details, nie Codes).
 */
export const GET: RequestHandler = async (event) => {
	const { url, cookies } = event;
	const k = nextcloud();
	if (!k?.anmeldung) error(404, 'Nicht gefunden');
	const zurueck = (hinweis: string): never => redirect(303, `/anmelden?hinweis=${hinweis}`);

	const flow = liesFlowCookie(cookies.get(FLOW_COOKIE));
	cookies.delete(FLOW_COOKIE, { path: FLOW_PFAD });
	if (!ssoBegrenzung.pruefeVersuch(`rueckruf:${ipVon(event)}`).erlaubt) zurueck('nextcloud-zu-oft');
	if (url.searchParams.get('error')) zurueck('nextcloud-abgebrochen');
	const code = url.searchParams.get('code') ?? '';
	const state = url.searchParams.get('state') ?? '';
	if (!flow || !code || code.length > 2000 || !gleich(state, flow.state)) zurueck('nextcloud-abgelaufen');

	let ergebnis: Awaited<ReturnType<typeof meldeUeberNextcloudAn>>;
	try {
		const iss = url.searchParams.get('iss');
		if (iss !== null && iss !== (await discovery(k)).issuer) zurueck('nextcloud-fehler');
		const identitaet = await tauscheCode(k, code, `${url.origin}${FLOW_PFAD}/rueckruf`, flow!);
		ergebnis = await meldeUeberNextcloudAn(k, identitaet);
	} catch (e) {
		if ((e as { status?: number; location?: string }).location) throw e; // redirect() von oben
		console.error('Nextcloud-Anmeldung:', (e as Error).message);
		return zurueck('nextcloud-fehler');
	}

	if (ergebnis.art === 'unbekannt') zurueck('nextcloud-unbekannt');
	if (ergebnis.art === 'verweigert') zurueck('nextcloud-verweigert');
	if (ergebnis.art === 'gesperrt') zurueck('gesperrt');
	for (const name of [COOKIE_NAME, VORSITZUNG_COOKIE]) {
		const alt = cookies.get(name);
		if (alt) await loescheSitzung(alt);
	}
	if (ergebnis.art === 'sitzung') {
		loescheVorsitzungsCookie(cookies);
		setzeSitzungsCookie(cookies, ergebnis.token);
		redirect(303, '/');
	}
	if (ergebnis.art === 'code' || ergebnis.art === 'einrichten') {
		setzeVorsitzungsCookie(cookies, ergebnis.token);
		redirect(303, ergebnis.art === 'code' ? '/anmelden/zweiter-faktor' : '/konto/zwei-faktor');
	}
	return zurueck('nextcloud-fehler');
};
