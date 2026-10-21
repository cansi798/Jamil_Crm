import type { PageServerLoad } from './$types';
import { listeVorlagenMitAufgaben } from '$lib/server/auftrag-vorlagen';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';

/** Liste aller Auftrags-Aufgaben-Vorlagen (mit Anzahl der Aufgaben für die Kennzahl-Zeile). */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const vorlagen = await alsSeitenFehler(() => listeVorlagenMitAufgaben(k));
	return {
		vorlagen: vorlagen.map((v) => ({ id: v.id, name: v.name, beschreibung: v.beschreibung, anzahlAufgaben: v.todos.length })),
		darfBearbeiten: hatRecht(locals.nutzer!, 'auftraege.bearbeiten')
	};
};
