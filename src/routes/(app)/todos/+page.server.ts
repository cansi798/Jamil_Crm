import type { Actions, PageServerLoad } from './$types';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff, vorbelegung } from '$lib/server/seite';
import { todoAktionen } from '$lib/server/todo-aktionen';
import { aktiveMitarbeiter, listeTodos, todoSichtVon, type TodoAuswahl } from '$lib/server/todos';
import { todoSpalte } from '$lib/todo-board';
import { UUID } from '$lib/server/kunden';
import { berlinTag } from '$lib/zeit';

/**
 * Aufgaben als Board oder Liste (wie Aufträge) mit Reitern „Meine“ / „Offen“ / „Alle“ (die beiden letzten nur mit `auftraege.alle_lesen`). Überfällig ist,
 * was vor dem heutigen Tag (Berlin) fällig und noch offen ist.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	// Sicht nach dem Recht „Alle Aufgaben ansehen“ (sonst: eigene + die in eigenen Aufträgen)
	const sicht = todoSichtVon(nutzer);
	const reiter: TodoAuswahl[] = sicht.alle ? ['meine', 'offen', 'alle'] : ['meine'];
	const roh = url.searchParams.get('nur');
	const nur = reiter.find((r) => r === roh) ?? 'meine';
	// Ansicht wie bei den Aufträgen: Board (Standard) oder Liste (`?ansicht=liste`)
	const ansicht = url.searchParams.get('ansicht') === 'liste' ? 'liste' : 'board';
	const darfBearbeiten = hatRecht(nutzer, 'auftraege.bearbeiten');
	// „Zugewiesen an“ (Jamil msg 2806): Vorgabe ist der angemeldete Benutzer. Ohne `person` in der Adresse gilt
	// „ich“ – bewusst ohne Weiterleitung: die leere Adresse bleibt „erster Besuch“, damit eine gespeicherte
	// Standard-Ansicht greifen kann (msg 2921). `person=alle` bzw. `person=<id>` wählt ausdrücklich. Nur mit
	// „Alle Aufgaben ansehen“; sonst gilt ohnehin „meine“.
	const person = url.searchParams.get('person');
	// Ohne `person`: „ich“ – außer der ältere Reiter `nur=offen|alle` ist ausdrücklich gewählt (Lesezeichen, Links)
	const ohnePerson = roh === 'offen' || roh === 'alle' ? undefined : nutzer.id;
	const zustaendigId = sicht.alle
		? person && UUID.test(person) ? person : person === 'alle' || person === '' ? undefined : person === null ? ohnePerson : nutzer.id
		: undefined;
	// Status-Chips (Jamil msg 2805): Offen | In Arbeit | Erledigt | Alle – wie die Spalten des Boards
	const statusRoh = url.searchParams.get('status');
	const status = statusRoh === 'offen' || statusRoh === 'in-arbeit' || statusRoh === 'erledigt' ? statusRoh : 'alle';
	const [geladen, mitarbeiter] = await alsSeitenFehler(() =>
		Promise.all([
			listeTodos(k, sicht, { nur: sicht.alle ? 'alle' : nur, zustaendigId, status: status === 'erledigt' ? 'erledigt' : status === 'alle' ? undefined : 'offen' }),
			darfBearbeiten || sicht.alle ? aktiveMitarbeiter(k) : Promise.resolve([])
		])
	);
	const todos = status === 'offen' || status === 'in-arbeit' ? geladen.filter((t) => todoSpalte(t) === status) : geladen;
	return {
		ansicht,
		nur,
		reiter,
		filter: { person: zustaendigId ?? 'alle', status },
		personFilter: sicht.alle,
		todos,
		mitarbeiter,
		heute: berlinTag(new Date()),
		darfBearbeiten,
		benutzerId: nutzer.id,
		// „+ Aufgabe“ vorbelegt (z. B. „Ändern“ auf der Bestätigungskarte der Sprachsteuerung)
		vorbelegt: vorbelegung(url, ['titel', 'faellig'])
	};
};

export const actions: Actions = todoAktionen(false);
