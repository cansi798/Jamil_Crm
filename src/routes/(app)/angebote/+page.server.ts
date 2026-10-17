import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listeAngebote, MAX_ANGEBOTE } from '$lib/server/angebote';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istAngebotStatus } from '$lib/angebot-status';

/** Angebotsliste mit Status-Reitern (`?status=`, unbekannt → alle). Rechte: angebote.bearbeiten + preise.sehen. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	const roh = url.searchParams.get('status');
	const status = istAngebotStatus(roh) ? roh : null;
	return {
		status,
		angebote: await alsSeitenFehler(() => listeAngebote(k, { status: status ?? undefined })),
		maxTreffer: MAX_ANGEBOTE
	};
};
