import type { Actions, PageServerLoad } from './$types';
import { detailAktionen, detailLaden } from '$lib/server/formular-vorlagen-seite';

/** Baukasten einer Protokoll-Vorlage (Aufmaß-Vorlagen leiten auf /einstellungen/aufmass-vorlagen/<id> weiter). */
export const load: PageServerLoad = detailLaden('protokoll');
export const actions: Actions = detailAktionen('protokoll');
