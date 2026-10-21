import type { Actions, PageServerLoad } from './$types';
import { detailAktionen, detailLaden } from '$lib/server/formular-vorlagen-seite';

/** Baukasten einer Aufmaß-Vorlage (Protokoll-Vorlagen leiten auf /einstellungen/protokoll-vorlagen/<id> weiter). */
export const load: PageServerLoad = detailLaden('aufmass');
export const actions: Actions = detailAktionen('aufmass');
