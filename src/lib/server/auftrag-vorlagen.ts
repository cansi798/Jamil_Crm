import { inEinerTransaktion, mitBetrieb, type Kontext, type Quelle } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { sichtbar } from './auftraege';
import { auftragsSichtAus, legeTodosAn, stufeFeld, type Todo, type TodoSicht } from './todos';
import { istVorlageModus, vorlageAufteilen, type VorlageModus } from '../aufgaben';

/**
 * Fachlogik für Auftrags-Aufgaben-Vorlagen (Modul `auftraege`).
 *
 * Vorlagen speichern wiederkehrende Aufgabenlisten für Aufträge (z.B. "Wartung Heizung" mit 5 Aufgaben).
 * Beim Anlegen eines Auftrags kann eine Vorlage gewählt werden, die Aufgaben werden automatisch erstellt.
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
	/** 1 gering, 2 mittel, 3 hoch – wird beim Anwenden in die Auftrags-Aufgaben übernommen. */
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

/** Prüft die Eingaben eines Vorlagen-Aufgaben und liefert bereinigte Werte. */
export function pruefeTodoEingabe(e: Record<string, unknown>, index: number): TodoWerte {
	const titel = textFeld(e.titel, `Aufgabe ${index + 1}: Titel`, 200);
	if (!titel || titel.length < 1) throw new ApiFehler(400, `Aufgabe ${index + 1}: Titel ist erforderlich.`);
	const beschreibung = textFeld(e.beschreibung, `Aufgabe ${index + 1}: Beschreibung`, 500) || null;
	const sortierung = typeof e.sortierung === 'number' && Number.isInteger(e.sortierung) ? e.sortierung : index;
	return {
		titel,
		beschreibung,
		lautstaerke: stufeFeld(e.lautstaerke, `Aufgabe ${index + 1}: Lautstärke`),
		schmutz: stufeFeld(e.schmutz, `Aufgabe ${index + 1}: Schmutz`),
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

/** Liefert eine Vorlage mit Aufgaben (404 wenn nicht gefunden oder fremder Betrieb). */
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

/** Legt eine Vorlage mit Aufgaben an. */
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

/** Ändert eine Vorlage. Aufgaben werden komplett ersetzt, wenn `todos` angegeben ist. */
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

/** Löscht eine Vorlage (Aufgaben werden mitgelöscht). */
export async function loescheVorlage(k: Kontext, id: string): Promise<void> {
	const vorlageId = idFeld(id);
	await mitBetrieb(k, async (tx) => {
		const erg = await tx`delete from app.auftrag_vorlagen where id = ${vorlageId}`;
		if (erg.count === 0) throw nichtGefunden();
	});
}

/** Alle Vorlagen mit ihren Aufgaben (für „Aufgaben aus Vorlage“ am Auftrag: Auswahl und Vorschau ohne Nachladen). */
export async function listeVorlagenMitAufgaben(k: Kontext): Promise<VorlageMitTodos[]> {
	return mitBetrieb(k, async (tx) => {
		const vs = await tx`select id, name, beschreibung, angelegt, geaendert from app.auftrag_vorlagen order by name, id`;
		const ts = await tx`
			select id, vorlage_id, titel, beschreibung, lautstaerke, schmutz, sortierung
			from app.auftrag_vorlagen_todos order by vorlage_id, sortierung, id`;
		return vs.map((v) => ({
			id: v.id as string,
			name: v.name as string,
			beschreibung: v.beschreibung as string | null,
			angelegt: (v.angelegt as Date).toISOString(),
			geaendert: (v.geaendert as Date).toISOString(),
			todos: ts
				.filter((t) => t.vorlage_id === v.id)
				.map((t) => ({
					id: t.id as string,
					titel: t.titel as string,
					beschreibung: t.beschreibung as string | null,
					lautstaerke: (t.lautstaerke as number | null) ?? null,
					schmutz: (t.schmutz as number | null) ?? null,
					sortierung: t.sortierung as number
				}))
		}));
	});
}

export type VorlageAngewendet = { vorlage: { id: string; name: string }; angelegt: Todo[]; uebersprungen: string[] };

/**
 * Aufgaben-Vorlage auf einen BESTEHENDEN Auftrag anwenden (Jamil msg 2975) – gleiche Logik wie beim Anlegen eines
 * Auftrags: Titel, Beschreibung, Lautstärke/Schmutz und die Herkunft (Zeitmessung je Vorlagen-Aufgabe). Gleichnamige
 * Aufgaben am Auftrag: `fehlende` (Standard) lässt sie weg, `alle` legt sie trotzdem an. Optional für alle neuen
 * Aufgaben gemeinsam: Mitarbeiter und Tag/Zeitraum (sonst „nicht zugewiesen“, ohne Datum).
 * Rechte wie „Aufgabe anlegen“ am Auftrag (prüft der Aufrufer: `auftraege.bearbeiten`); der Auftrag muss sichtbar sein.
 * Alles in EINER Transaktion; im Verlauf des Auftrags steht danach „Aufgaben-Vorlage … übernommen“.
 */
export async function wendeVorlageAn(
	k: Kontext,
	sicht: TodoSicht,
	auftragId: string,
	vorlageId: string,
	modus: unknown = 'fehlende',
	gemeinsam: { mitarbeiterIds?: unknown; faellig?: unknown; faelligZeit?: unknown; vonTag?: unknown; vonZeit?: unknown } = {},
	quelle: Quelle = 'oberflaeche'
): Promise<VorlageAngewendet> {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(400, 'Der Auftrag wurde nicht gefunden.');
	if (typeof vorlageId !== 'string' || vorlageId === '') throw new ApiFehler(400, 'Bitte eine Vorlage wählen.');
	const m: VorlageModus = modus === undefined || modus === null || modus === '' ? 'fehlende' : istVorlageModus(modus) ? modus : (() => {
		throw new ApiFehler(400, 'Unbekannte Auswahl bei gleichnamigen Aufgaben.');
	})();
	return inEinerTransaktion(k, quelle, async () => {
		const titel = await mitBetrieb(k, async (tx) => {
			const [a] = await tx`
				select 1 from app.auftraege a
				where a.id = ${auftragId} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, auftragsSichtAus(sicht))} for key share of a`;
			if (!a) throw new ApiFehler(400, 'Der Auftrag wurde nicht gefunden.');
			return (await tx`select titel from app.todos where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId}`).map((r) => r.titel as string);
		});
		const v = await holeVorlage(k, vorlageId);
		if (v.todos.length === 0) throw new ApiFehler(400, `Die Vorlage „${v.name}“ hat keine Aufgaben.`);
		const { neu, doppelt } = vorlageAufteilen(v.todos, titel, m);
		const angelegt = await legeTodosAn(
			k,
			auftragId,
			neu.map((t) => ({ titel: t.titel, beschreibung: t.beschreibung, lautstaerke: t.lautstaerke, schmutz: t.schmutz, vorlageId: v.id, vorlageAufgabe: t.titel })),
			sicht,
			gemeinsam
		);
		return { vorlage: { id: v.id, name: v.name }, angelegt, uebersprungen: m === 'fehlende' ? doppelt.map((t) => t.titel) : [] };
	});
}

const zeitFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Verlauf des Auftrags: „Aufgaben-Vorlage „X“ übernommen (N Aufgaben)“ – aus dem Änderungsprotokoll der Aufgaben
 * (angelegt mit Herkunft Vorlage; gleiche Transaktion = gleicher Zeitstempel = ein Eintrag).
 */
export async function vorlagenVerlauf(
	k: Kontext,
	auftragId: string
): Promise<{ iso: string; zeile: { id: string; zeit: string; wer: string; titel: string; aenderungen: { feld: string; alt: string; neu: string }[] } }[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select min(a.id)::text as id, a.zeit, a.nachher ->> 'vorlage_id' as vorlage_id, count(*)::int as anzahl,
			max(b.name) as name, max(v.name) as vorlage, max(a.quelle) as quelle
		from app.aenderungen a
		left join app.benutzer b on b.id = a.benutzer_id
		left join app.auftrag_vorlagen v on v.id = (a.nachher ->> 'vorlage_id')::uuid and v.betrieb_id = a.betrieb_id
		where a.betrieb_id = ${k.betriebId} and a.tabelle = 'todos' and a.aktion = 'angelegt'
			and a.nachher ->> 'auftrag_id' = ${auftragId} and a.nachher ->> 'vorlage_id' is not null
		group by a.zeit, a.nachher ->> 'vorlage_id', a.benutzer_id
		order by a.zeit desc limit 50`);
	return z.map((r) => ({
		iso: new Date(r.zeit).toISOString(),
		zeile: {
			id: `av${r.id}`,
			zeit: zeitFormat.format(new Date(r.zeit)),
			wer: r.name ?? 'System',
			titel: `Aufgaben-Vorlage „${r.vorlage ?? 'gelöschte Vorlage'}“ übernommen (${r.anzahl} ${r.anzahl === 1 ? 'Aufgabe' : 'Aufgaben'})${r.quelle === 'sprache' ? ' – per Sprache' : ''}`,
			aenderungen: []
		}
	}));
}
