import type { Actions, PageServerLoad } from './$types';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff, vorbelegung } from '$lib/server/seite';
import { todoAktionen } from '$lib/server/todo-aktionen';
import { aktiveMitarbeiter, listeTodos, todoSichtVon, type TodoAuswahl } from '$lib/server/todos';
import { UUID } from '$lib/server/kunden';
import { berlinTag } from '$lib/zeit';

/**
 * To-dos mit Reitern „Meine“ / „Offen“ / „Alle“ (die beiden letzten nur mit `auftraege.alle_lesen`). Überfällig ist,
 * was vor dem heutigen Tag (Berlin) fällig und noch offen ist.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	// Sicht nach dem Recht „Alle To-dos ansehen“ (sonst: eigene + die in eigenen Aufträgen)
	const sicht = todoSichtVon(nutzer);
	const reiter: TodoAuswahl[] = sicht.alle ? ['meine', 'offen', 'alle'] : ['meine'];
	const roh = url.searchParams.get('nur');
	const nur = reiter.find((r) => r === roh) ?? 'meine';
	const darfBearbeiten = hatRecht(nutzer, 'auftraege.bearbeiten');
	// Filter „zugewiesen an“ und „Status“ (kombinierbar mit den Reitern)
	const person = url.searchParams.get('person') ?? '';
	const zustaendigId = UUID.test(person) ? person : undefined;
	const statusRoh = url.searchParams.get('status');
	const status = statusRoh === 'offen' || statusRoh === 'erledigt' ? statusRoh : undefined;
	const [todos, mitarbeiter] = await alsSeitenFehler(() =>
		Promise.all([
			listeTodos(k, sicht, { nur, zustaendigId, status }),
			darfBearbeiten || sicht.alle ? aktiveMitarbeiter(k) : Promise.resolve([])
		])
	);
	return {
		nur,
		reiter,
		filter: { person: zustaendigId ?? '', status: status ?? '' },
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
