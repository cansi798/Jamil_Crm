import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { stufeFeld } from './todos';

/**
 * Fachlogik für Auftrags-To-do-Vorlagen (Modul `auftraege`).
 *
 * Vorlagen speichern wiederkehrende To-do-Listen für Aufträge (z.B. "Wartung Heizung" mit 5 Aufgaben).
 * Beim Anlegen eines Auftrags kann eine Vorlage gewählt werden, die To-dos werden automatisch erstellt.
 */

export type Vorlage = {
	id: string;
	name: string;
	beschreibung: string | null;
	angelegt: string;
	geaendert: string;
};

export type VorlageTodo = {
	id: string;
	titel: string;
	beschreibung: string | null;
	/** 1 gering, 2 mittel, 3 hoch – wird beim Anwenden in die Auftrags-To-dos übernommen. */
	lautstaerke: number | null;
	schmutz: number | null;
	sortierung: number;
};

export type VorlageMitTodos = Vorlage & { todos: VorlageTodo[] };

export type VorlageWerte = {
	name: string;
	beschreibung: string | null;
};

export type TodoWerte = {
	titel: string;
	beschreibung: string | null;
	lautstaerke: number | null;
	schmutz: number | null;
	sortierung: number;
};

const nichtGefunden = () => new ApiFehler(404, 'Vorlage nicht gefunden.');

function idFeld(wert: unknown): string {
	if (typeof wert !== 'string' || !UUID.test(wert.trim())) throw nichtGefunden();
	return wert.trim().toLowerCase();
}

/** Prüft die Eingaben einer Vorlage und liefert bereinigte Werte. */
export function pruefeVorlageEingabe(e: Record<string, unknown>): VorlageWerte {
	const name = textFeld(e.name, 'Name', 100);
	if (!name || name.length < 1) throw new ApiFehler(400, 'Name ist erforderlich.');
	const beschreibung = textFeld(e.beschreibung, 'Beschreibung', 500) || null;
	return { name, beschreibung };
}

/** Prüft die Eingaben eines Vorlagen-To-dos und liefert bereinigte Werte. */
export function pruefeTodoEingabe(e: Record<string, unknown>, index: number): TodoWerte {
	const titel = textFeld(e.titel, `To-do ${index + 1}: Titel`, 200);
	if (!titel || titel.length < 1) throw new ApiFehler(400, `To-do ${index + 1}: Titel ist erforderlich.`);
	const beschreibung = textFeld(e.beschreibung, `To-do ${index + 1}: Beschreibung`, 500) || null;
	const sortierung = typeof e.sortierung === 'number' && Number.isInteger(e.sortierung) ? e.sortierung : index;
	return {
		titel,
		beschreibung,
		lautstaerke: stufeFeld(e.lautstaerke, `To-do ${index + 1}: Lautstärke`),
		schmutz: stufeFeld(e.schmutz, `To-do ${index + 1}: Schmutz`),
		sortierung
	};
}

/** Liefert alle Vorlagen des Betriebs. */
export async function listeVorlagen(k: Kontext): Promise<Vorlage[]> {
	return mitBetrieb(k, async (tx) => {
		const rows = await tx`
			select id, name, beschreibung, angelegt, geaendert
			from app.auftrag_vorlagen
			order by name`;
		return rows.map((r) => ({
			id: r.id as string,
			name: r.name as string,
			beschreibung: r.beschreibung as string | null,
			angelegt: (r.angelegt as Date).toISOString(),
			geaendert: (r.geaendert as Date).toISOString()
		}));
	});
}

/** Liefert eine Vorlage mit To-dos (404 wenn nicht gefunden oder fremder Betrieb). */
export async function holeVorlage(k: Kontext, id: string): Promise<VorlageMitTodos> {
	const vorlageId = idFeld(id);
	return mitBetrieb(k, async (tx) => {
		const [v] = await tx`
			select id, name, beschreibung, angelegt, geaendert
			from app.auftrag_vorlagen
			where id = ${vorlageId}`;
		if (!v) throw nichtGefunden();

		const todos = await tx`
			select id, titel, beschreibung, lautstaerke, schmutz, sortierung
			from app.auftrag_vorlagen_todos
			where vorlage_id = ${vorlageId}
			order by sortierung`;

		return {
			id: v.id as string,
			name: v.name as string,
			beschreibung: v.beschreibung as string | null,
			angelegt: (v.angelegt as Date).toISOString(),
			geaendert: (v.geaendert as Date).toISOString(),
			todos: todos.map((t) => ({
				id: t.id as string,
				titel: t.titel as string,
				beschreibung: t.beschreibung as string | null,
				lautstaerke: (t.lautstaerke as number | null) ?? null,
				schmutz: (t.schmutz as number | null) ?? null,
				sortierung: t.sortierung as number
			}))
		};
	});
}

/** Legt eine Vorlage mit To-dos an. */
export async function legeVorlageAn(
	k: Kontext,
	e: { name: string; beschreibung?: string; todos?: { titel: string; beschreibung?: string | null; lautstaerke?: unknown; schmutz?: unknown; sortierung?: number }[] }
): Promise<VorlageMitTodos> {
	const werte = pruefeVorlageEingabe(e);
	const todos = (e.todos ?? []).map((t, i) => pruefeTodoEingabe(t, i));

	const vorlageId = await mitBetrieb(k, async (tx) => {
		const [v] = await tx`
			insert into app.auftrag_vorlagen (betrieb_id, name, beschreibung)
			values (${k.betriebId}, ${werte.name}, ${werte.beschreibung})
			returning id`;
		const id = v.id as string;

		for (const todo of todos) {
			await tx`
				insert into app.auftrag_vorlagen_todos (betrieb_id, vorlage_id, titel, beschreibung, lautstaerke, schmutz, sortierung)
				values (${k.betriebId}, ${id}, ${todo.titel}, ${todo.beschreibung}, ${todo.lautstaerke}, ${todo.schmutz}, ${todo.sortierung})`;
		}

		return id;
	});

	return holeVorlage(k, vorlageId);
}

/** Ändert eine Vorlage. To-dos werden komplett ersetzt, wenn `todos` angegeben ist. */
export async function aendereVorlage(
	k: Kontext,
	id: string,
	e: { name?: string; beschreibung?: string; todos?: { titel: string; beschreibung?: string | null; lautstaerke?: unknown; schmutz?: unknown; sortierung?: number }[] }
): Promise<VorlageMitTodos> {
	const vorlageId = idFeld(id);
	const todos = e.todos?.map((t, i) => pruefeTodoEingabe(t, i));

	await mitBetrieb(k, async (tx) => {
		// Vorlage muss existieren (404)
		const [vorhanden] = await tx`select 1 from app.auftrag_vorlagen where id = ${vorlageId}`;
		if (!vorhanden) throw nichtGefunden();

		if (e.name !== undefined || e.beschreibung !== undefined) {
			const werte = pruefeVorlageEingabe({ name: e.name ?? '', beschreibung: e.beschreibung ?? '' });
			await tx`
				update app.auftrag_vorlagen
				set name = ${werte.name}, beschreibung = ${werte.beschreibung}
				where id = ${vorlageId}`;
		}

		if (todos) {
			await tx`delete from app.auftrag_vorlagen_todos where vorlage_id = ${vorlageId}`;
			for (const todo of todos) {
				await tx`
					insert into app.auftrag_vorlagen_todos (betrieb_id, vorlage_id, titel, beschreibung, lautstaerke, schmutz, sortierung)
					values (${k.betriebId}, ${vorlageId}, ${todo.titel}, ${todo.beschreibung}, ${todo.lautstaerke}, ${todo.schmutz}, ${todo.sortierung})`;
			}
		}
	});

	return holeVorlage(k, vorlageId);
}

/** Löscht eine Vorlage (To-dos werden mitgelöscht). */
export async function loescheVorlage(k: Kontext, id: string): Promise<void> {
	const vorlageId = idFeld(id);
	await mitBetrieb(k, async (tx) => {
		const erg = await tx`delete from app.auftrag_vorlagen where id = ${vorlageId}`;
		if (erg.count === 0) throw nichtGefunden();
	});
}
