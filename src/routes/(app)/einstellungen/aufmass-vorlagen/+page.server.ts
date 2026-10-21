import type { Actions, PageServerLoad } from './$types';
import { listeAktionen, listeLaden } from '$lib/server/formular-vorlagen-seite';

/** Einstellungen → Aufmaß-Vorlagen (msg 2842): gleicher Baukasten wie Protokolle, eigene Adresse (msg 3085). */
export const load: PageServerLoad = listeLaden('aufmass');
export const actions: Actions = listeAktionen('aufmass');
