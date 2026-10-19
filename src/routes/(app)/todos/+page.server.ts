import type { Actions, PageServerLoad } from './$types';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff, vorbelegung } from '$lib/server/seite';
import { todoAktionen } from '$lib/server/todo-aktionen';
import { aktiveMitarbeiter, listeTodos, type TodoAuswahl } from '$lib/server/todos';
import { berlinTag } from '$lib/zeit';

/**
 * To-dos mit Reitern „Meine“ / „Offen“ / „Alle“ (die beiden letzten nur mit `auftraege.alle_lesen`). Überfällig ist,
 * was vor dem heutigen Tag (Berlin) fällig und noch offen ist.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	const sicht = sichtVon(nutzer);
	const reiter: TodoAuswahl[] = sicht.alle ? ['meine', 'offen', 'alle'] : ['meine'];
	const roh = url.searchParams.get('nur');
	const nur = reiter.find((r) => r === roh) ?? 'meine';
	const darfBearbeiten = hatRecht(nutzer, 'auftraege.bearbeiten');
	const [todos, mitarbeiter] = await alsSeitenFehler(() =>
		Promise.all([listeTodos(k, sicht, { nur }), darfBearbeiten ? aktiveMitarbeiter(k) : Promise.resolve([])])
	);
	return {
		nur,
		reiter,
		todos,
		mitarbeiter,
		heute: berlinTag(new Date()),
		darfBearbeiten,
		benutzerId: nutzer.id,
		// „+ To-do“ vorbelegt (z. B. „Ändern“ auf der Bestätigungskarte der Sprachsteuerung)
		vorbelegt: vorbelegung(url, ['titel', 'faellig'])
	};
};

export const actions: Actions = todoAktionen(false);
