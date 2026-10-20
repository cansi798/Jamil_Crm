import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ladeVerwaltung } from '$lib/server/buchung-oeffentlich';
import { OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';
import { abgedunkelt, akzentLesbar, aufgehellt } from '$lib/farben';

/**
 * Bestätigung und Verwaltung einer Buchung (/buchung/<Verwaltungs-Token>, ohne Anmeldung): Termin ansehen, als
 * Kalenderdatei laden, absagen oder verschieben. Nur wer den Link aus der Bestätigung hat, kommt hierher.
 */
export const load: PageServerLoad = async ({ params, locals, setHeaders, url }) => {
	setHeaders({ ...OEFFENTLICHE_KOPFZEILEN });
	const v = await ladeVerwaltung(params.token);
	if (!v) error(404, 'Diese Buchung gibt es nicht (mehr).');
	locals.einbettenErlaubt = v.einbetten;
	const akzent = akzentLesbar(v.betrieb.farbe);
	const { einbetten: _e, id: _id, ...rest } = v;
	return {
		token: params.token,
		buchung: rest,
		neu: url.searchParams.get('neu') === '1',
		farben: { akzent, hover: abgedunkelt(akzent, 0.85), dunkel: abgedunkelt(akzent, 0.7), hell: aufgehellt(akzent, 0.12), zart: aufgehellt(akzent, 0.05) }
	};
};
