import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { hatRecht } from '$lib/server/rechte';
import { seitenZugriff } from '$lib/server/seite';

/** Angebots-Vorlagen enthalten Preise: Modul `angebote`, `angebote.bearbeiten` UND `preise.sehen` (wie Angebote). */
export const load: LayoutServerLoad = async ({ locals }) => {
	await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	return {};
};
