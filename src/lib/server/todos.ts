import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { sichtbar, type Sicht } from './auftraege';
import { hatRecht } from './rechte';
import { darfEines } from './tarif';
import { textFeld, UUID } from './kunden';
import { berlinTag, istTag } from '../zeit';
import { istRegel, naechsterTermin, pruefeRegel, regelText, type Regel } from '../wiederholung';

/**
 * To-dos (Modul `auftraege`): zu einem Auftrag oder allgemein, mit Zuständigem und Fälligkeit.
 *
 * Sichtbar sind mit `auftraege.alle_lesen` alle To-dos des Betriebs, sonst die eigenen (zuständig) und die in
 * sichtbaren Aufträgen (siehe `sichtbar` in auftraege.ts). Unsichtbare, fremde und unbekannte To-dos sind ein 404.
 * Anlegen, Ändern und Löschen: `auftraege.bearbeiten` (prüft der Aufrufer) – und nur, was der Nutzer sieht (`Sicht`).
 * Ein To-do an einem unsichtbaren Auftrag lässt sich weder ändern (404) noch neu anlegen (400). Zusätzlich darf der Zuständige sein
 * eigenes To-do mit `auftraege.lesen` abhaken und wieder öffnen (`setzeErledigt`) – sonst nichts.
 */

export type Todo = {
	id: string;
	titel: string;
	beschreibung: string | null;
	/** Belastung für Bewohner: Lautstärke und Schmutz, je Stufe 1–5 (optional). */
	lautstaerke: number | null;
	schmutz: number | null;
	auftragId: string | null;
	auftragNummer: string | null;
	auftragTitel: string | null;
	zustaendigId: string | null;
	zustaendigName: string | null;
	faellig: string | null;
	erledigt: boolean;
	erledigtAm: string | null;
	/** Nur in Listen: dem Nutzer direkt zugewiesen (sonst über einen Auftrag, für den er zuständig ist). */
	mirDirekt?: boolean;
	/** Wiederkehrendes To-do: Serie mit Regel als Text („alle 2 Wochen“), sonst null. */
	serie: { id: string; text: string; aktiv: boolean } | null;
};

/** Filter (Wunsch Jamil, msg 2500): `zustaendigId` (zugewiesen an), `status` offen/erledigt – kombinierbar mit `nur`. */
export type TodoFilter = { auftragId?: string; nur?: TodoAuswahl; zustaendigId?: string; status?: 'offen' | 'erledigt' };

export const TODO_AUSWAHL = ['meine', 'offen', 'alle'] as const;
export type TodoAuswahl = (typeof TODO_AUSWAHL)[number];

/** Felder beim Anlegen (Formular/JSON); `auftragId` nur beim Anlegen, danach fest. */
export const TODO_FELDER = [
	'titel',
	'beschreibung',
	'auftragId',
	'zustaendigId',
	'faellig',
	'lautstaerke',
	'schmutz',
	'wiederholung',
	'intervall',
	'wiederholungEnde'
] as const;
const AENDERBAR = ['titel', 'beschreibung', 'zustaendigId', 'faellig', 'lautstaerke', 'schmutz'] as const;

export const MAX_TODOS = 200;
/** Höchstens so viele To-dos auf einmal (z. B. aus einer Auftrags-Vorlage). */
export const MAX_TODOS_AUF_EINMAL = 50;

const nichtGefunden = () => new ApiFehler(404, 'To-do nicht gefunden.');

export const istTodoAuswahl = (w: unknown): w is TodoAuswahl =>
	typeof w === 'string' && (TODO_AUSWAHL as readonly string[]).includes(w);

function idFeld(wert: unknown, meldung: string): string | null {
	if (wert === undefined || wert === null || wert === '') return null;
	if (typeof wert !== 'string' || !UUID.test(wert.trim())) throw new ApiFehler(400, meldung);
	return wert.trim().toLowerCase();
}

function datumFeld(wert: unknown): string | null {
	if (wert === undefined || wert === null || wert === '') return null;
	if (!istTag(wert)) throw new ApiFehler(400, 'Das Datum „Fällig“ ist ungültig.');
	return wert;
}

/** Stufe 1–3 (gering, mittel, hoch; Zahl oder Text aus dem Formular); leer → null; sonst 400. */
export function stufeFeld(wert: unknown, name: string): number | null {
	if (wert === undefined || wert === null || wert === '') return null;
	const n = typeof wert === 'string' && /^\s*[1-3]\s*$/.test(wert) ? Number(wert) : wert;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3) {
		throw new ApiFehler(400, `${name}: Bitte gering, mittel oder hoch wählen.`);
	}
	return n;
}

/** `true`/`false` (auch aus Formularen als Text). Alles andere → 400. */
export function erledigtWert(w: unknown): boolean {
	if (w === true || w === 'true') return true;
	if (w === false || w === 'false') return false;
	throw new ApiFehler(400, '„erledigt“ muss true oder false sein.');
}

type TodoWerte = {
	titel: string;
	beschreibung: string | null;
	auftragId: string | null;
	zustaendigId: string | null;
	faellig: string | null;
	lautstaerke: number | null;
	schmutz: number | null;
};

function pruefeTodoEingabe(e: Record<string, unknown>): TodoWerte {
	const titel = textFeld(e.titel, 'Titel', 200);
	if (titel === null) throw new ApiFehler(400, 'Bitte einen Titel eingeben.');
	return {
		titel,
		beschreibung: textFeld(e.beschreibung, 'Beschreibung', 500),
		auftragId: idFeld(e.auftragId, 'Der Auftrag ist ungültig.'),
		zustaendigId: idFeld(e.zustaendigId, 'Zuständig: ungültige Auswahl.'),
		faellig: datumFeld(e.faellig),
		lautstaerke: stufeFeld(e.lautstaerke, 'Lautstärke'),
		schmutz: stufeFeld(e.schmutz, 'Schmutz')
	};
}

const AUSWAHL = `t.id, t.titel, t.beschreibung, t.lautstaerke, t.schmutz, t.auftrag_id, a.nummer as auftrag_nummer, a.titel as auftrag_titel, t.zustaendig_id,
	b.name as zustaendig_name, to_char(t.faellig, 'YYYY-MM-DD') as faellig, t.erledigt_am,
	t.serie_id, s.regel as serie_regel, s.intervall as serie_intervall, to_char(s.ende, 'YYYY-MM-DD') as serie_ende,
	s.aktiv as serie_aktiv`;

const VON = `app.todos t
	left join app.auftraege a on a.id = t.auftrag_id and a.betrieb_id = t.betrieb_id
	left join app.benutzer b on b.id = t.zustaendig_id and b.betrieb_id = t.betrieb_id
	left join app.todo_serien s on s.id = t.serie_id and s.betrieb_id = t.betrieb_id`;

function zuTodo(z: Record<string, any>): Todo {
	return {
		id: z.id,
		titel: z.titel,
		beschreibung: z.beschreibung ?? null,
		lautstaerke: z.lautstaerke ?? null,
		schmutz: z.schmutz ?? null,
		auftragId: z.auftrag_id,
		auftragNummer: z.auftrag_nummer ?? null,
		auftragTitel: z.auftrag_titel ?? null,
		zustaendigId: z.zustaendig_id,
		zustaendigName: z.zustaendig_name ?? null,
		faellig: z.faellig,
		erledigt: z.erledigt_am !== null,
		erledigtAm: z.erledigt_am === null ? null : new Date(z.erledigt_am).toISOString(),
		serie: z.serie_id
			? { id: z.serie_id, text: regelText(z.serie_regel, Number(z.serie_intervall), z.serie_ende ?? null), aktiv: z.serie_aktiv }
			: null
	};
}

/** SQL-Bedingung „To-do für diese Sicht sichtbar“ (Aliasse t, a wie in VON). */
/**
 * Sicht auf To-dos (Wunsch Jamil, msg 2499): `alle` = Recht „Alle To-dos ansehen“ (`todos.alle_lesen`), sonst die
 * eigenen – direkt zugewiesen oder in Aufträgen mit eigenem Bezug (zuständig, eigenes To-do, eigener Termin).
 * `auftraegeAlle` (Recht „Alle Aufträge ansehen“) gilt nur dafür, an welche Aufträge man To-dos hängen darf.
 */
export type TodoSicht = Sicht & { auftraegeAlle?: boolean };

export function todoSichtVon(nutzer: Nutzer): TodoSicht {
	return {
		alle: hatRecht(nutzer, 'todos.alle_lesen'),
		benutzerId: nutzer.id,
		auftraegeAlle: hatRecht(nutzer, 'auftraege.alle_lesen')
	};
}

/** Lesen (Modul `auftraege` + Aufträge lesen) prüfen und die To-do-Sicht liefern. */
export async function todoSicht(locals: { nutzer: Nutzer | null }): Promise<TodoSicht> {
	await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	return todoSichtVon(locals.nutzer!);
}

/** Aufträge, an die man To-dos hängen darf: alle (mit „Alle Aufträge ansehen“) oder die eigenen. */
const auftragsSichtAus = (sicht: TodoSicht): Sicht => ({ alle: sicht.auftraegeAlle ?? sicht.alle, benutzerId: sicht.benutzerId });

function todoSichtbar(tx: TransactionSql, sicht: Sicht) {
	if (sicht.alle) return tx`true`;
	return tx`(t.zustaendig_id = ${sicht.benutzerId} or (a.id is not null and ${sichtbar(tx, { alle: false, benutzerId: sicht.benutzerId })}))`;
}

async function ladeEines(tx: TransactionSql, k: Kontext, sicht: Sicht, id: string): Promise<Todo> {
	const [z] = await tx`
		select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
		where t.id = ${id} and t.betrieb_id = ${k.betriebId} and ${todoSichtbar(tx, sicht)}`;
	if (!z) throw nichtGefunden();
	return zuTodo(z);
}

const pruefeId = (id: string) => {
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden();
	return id;
};

/**
 * To-dos, offen vor erledigt, dann nach Fälligkeit (ohne Datum zuletzt), dann nach Anlage. `nur`: `meine` (mir
 * zugewiesen), `offen` (nicht erledigt), `alle` (Standard) – jeweils innerhalb der Sicht.
 */
export async function listeTodos(k: Kontext, sicht: Sicht, filter: TodoFilter): Promise<Todo[]> {
	const nur = filter.nur ?? 'alle';
	if (!istTodoAuswahl(nur)) throw new ApiFehler(400, 'Unbekannte Auswahl.');
	if (filter.auftragId !== undefined && !UUID.test(filter.auftragId)) throw new ApiFehler(400, 'Ungültiger Auftrag.');
	if (filter.zustaendigId !== undefined && !UUID.test(filter.zustaendigId)) throw new ApiFehler(400, 'Ungültige Person.');
	if (filter.status !== undefined && filter.status !== 'offen' && filter.status !== 'erledigt') {
		throw new ApiFehler(400, 'Unbekannter Status.');
	}
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(AUSWAHL)}, coalesce(t.zustaendig_id = ${sicht.benutzerId}, false) as mir_direkt
			from ${tx.unsafe(VON)}
			where t.betrieb_id = ${k.betriebId}
				and ${todoSichtbar(tx, sicht)}
				${filter.auftragId ? tx`and t.auftrag_id = ${filter.auftragId}` : tx``}
				${nur === 'meine'
					? tx`and (t.zustaendig_id = ${sicht.benutzerId} or exists (
							select 1 from app.auftrag_zustaendige az
							where az.auftrag_id = t.auftrag_id and az.betrieb_id = t.betrieb_id and az.benutzer_id = ${sicht.benutzerId}))`
					: tx``}
				${nur === 'offen' ? tx`and t.erledigt_am is null` : tx``}
				${filter.zustaendigId ? tx`and t.zustaendig_id = ${filter.zustaendigId}` : tx``}
				${filter.status === 'offen' ? tx`and t.erledigt_am is null` : filter.status === 'erledigt' ? tx`and t.erledigt_am is not null` : tx``}
			order by (t.erledigt_am is not null), t.faellig asc nulls last, t.angelegt, t.id
			limit ${MAX_TODOS}`;
		return z.map((r) => ({ ...zuTodo(r), mirDirekt: r.mir_direkt as boolean }));
	});
}

export async function holeTodo(k: Kontext, sicht: Sicht, id: string): Promise<Todo> {
	pruefeId(id);
	return mitBetrieb(k, (tx) => ladeEines(tx, k, sicht, id));
}

async function pruefeZustaendig(tx: TransactionSql, k: Kontext, id: string | null): Promise<void> {
	if (id === null) return;
	const [b] = await tx`select 1 from app.benutzer where id = ${id} and betrieb_id = ${k.betriebId} and aktiv`;
	if (!b) throw new ApiFehler(400, 'Zuständig kann nur ein aktiver Mitarbeiter des Betriebs sein.');
}

const ALLE = (k: Kontext): TodoSicht => ({ alle: true, benutzerId: k.benutzerId, auftraegeAlle: true });

export async function legeTodoAn(k: Kontext, e: Record<string, unknown>, sicht: Sicht = ALLE(k)): Promise<Todo> {
	const w = pruefeTodoEingabe(e);
	const wiederholung =
		e.wiederholung === undefined || e.wiederholung === null || e.wiederholung === ''
			? null
			: { regel: e.wiederholung, intervall: e.intervall, ende: e.wiederholungEnde };
	return mitBetrieb(k, async (tx) => {
		if (w.auftragId !== null) {
			const [a] = await tx`
				select 1 from app.auftraege a
				where a.id = ${w.auftragId} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, auftragsSichtAus(sicht))} for key share of a`;
			if (!a) throw new ApiFehler(400, 'Der Auftrag wurde nicht gefunden.');
		}
		await pruefeZustaendig(tx, k, w.zustaendigId);
		// Wiederholung (optional): Serie anlegen; erster Termin = Fälligkeit, ohne Fälligkeit heute
		let serieId: string | null = null;
		let faellig = w.faellig;
		if (wiederholung) {
			faellig = faellig ?? berlinTag(new Date());
			const r = regelOder400(wiederholung, faellig);
			const [s] = await tx`
				insert into app.todo_serien (betrieb_id, regel, intervall, start_tag, ende)
				values (${k.betriebId}, ${r.regel}, ${r.intervall}, ${faellig}, ${r.ende}) returning id`;
			serieId = s.id;
		}
		const [z] = await tx`
			insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig, lautstaerke, schmutz, serie_id)
			values (${k.betriebId}, ${w.auftragId}, ${w.titel}, ${w.beschreibung}, ${w.zustaendigId}, ${faellig},
				${w.lautstaerke}, ${w.schmutz}, ${serieId})
			returning id`;
		return ladeEines(tx, k, ALLE(k), z.id);
	});
}

export type NeuesTodo = { titel: string; beschreibung?: string | null; lautstaerke?: unknown; schmutz?: unknown };

/**
 * Neue To-dos aus dem Auftrag-Formular (Felder `todo_<n>` und `todo_beschreibung_<n>`, n = 0, 1, …) in der
 * Reihenfolge von n. Ganz leere Zeilen fallen weg; eine Beschreibung ohne Titel bleibt drin (→ 400 beim Prüfen).
 */
export function todosAusFormular(form: FormData): NeuesTodo[] {
	const nummern = new Set<number>();
	for (const schluessel of form.keys()) {
		const treffer = /^todo_(?:beschreibung_|lautstaerke_|schmutz_)?(\d{1,4})$/.exec(schluessel);
		if (treffer) nummern.add(Number(treffer[1]));
	}
	const text = (name: string) => {
		const w = form.get(name);
		return typeof w === 'string' ? w : '';
	};
	return [...nummern]
		.sort((a, b) => a - b)
		.map((n) => ({
			titel: text(`todo_${n}`),
			beschreibung: text(`todo_beschreibung_${n}`),
			lautstaerke: text(`todo_lautstaerke_${n}`),
			schmutz: text(`todo_schmutz_${n}`)
		}))
		.filter((t) => t.titel.trim() !== '' || t.beschreibung.trim() !== '');
}

/**
 * Prüft eine Liste neuer To-dos (Titel Pflicht, Beschreibung ≤ 500, höchstens MAX_TODOS_AUF_EINMAL) – ohne Datenbank,
 * damit Aufrufer vor dem Anlegen eines Auftrags prüfen können und kein halber Auftrag entsteht.
 */
export function pruefeTodoListe(
	liste: readonly NeuesTodo[]
): { titel: string; beschreibung: string | null; lautstaerke: number | null; schmutz: number | null }[] {
	if (liste.length > MAX_TODOS_AUF_EINMAL) {
		throw new ApiFehler(400, `Höchstens ${MAX_TODOS_AUF_EINMAL} To-dos auf einmal.`);
	}
	return liste.map((t, i) => {
		const titel = textFeld(t.titel, `To-do ${i + 1}: Titel`, 200);
		if (titel === null) throw new ApiFehler(400, `To-do ${i + 1}: Bitte einen Titel eingeben.`);
		return {
			titel,
			beschreibung: textFeld(t.beschreibung, `To-do ${i + 1}: Beschreibung`, 500),
			lautstaerke: stufeFeld(t.lautstaerke, `To-do ${i + 1}: Lautstärke`),
			schmutz: stufeFeld(t.schmutz, `To-do ${i + 1}: Schmutz`)
		};
	});
}

/**
 * Legt mehrere To-dos an einem Auftrag an (z. B. aus einer Auftrags-Vorlage) – alle oder keins, in der gegebenen
 * Reihenfolge (angelegt = clock_timestamp(), Migration 021). Ohne Zuständigen und Fälligkeit. Der Auftrag muss für
 * die Sicht sichtbar sein, sonst 400 (wie beim einzelnen To-do).
 */
export async function legeTodosAn(
	k: Kontext,
	auftragId: string,
	liste: readonly NeuesTodo[],
	sicht: Sicht = ALLE(k)
): Promise<Todo[]> {
	const werte = pruefeTodoListe(liste);
	const auftrag = idFeld(auftragId, 'Der Auftrag ist ungültig.');
	if (auftrag === null) throw new ApiFehler(400, 'Der Auftrag ist ungültig.');
	if (werte.length === 0) return [];
	return mitBetrieb(k, async (tx) => {
		const [a] = await tx`
			select 1 from app.auftraege a
			where a.id = ${auftrag} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, auftragsSichtAus(sicht))} for key share of a`;
		if (!a) throw new ApiFehler(400, 'Der Auftrag wurde nicht gefunden.');
		const ids: string[] = [];
		for (const w of werte) {
			const [z] = await tx`
				insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, lautstaerke, schmutz)
				values (${k.betriebId}, ${auftrag}, ${w.titel}, ${w.beschreibung}, ${w.lautstaerke}, ${w.schmutz})
				returning id`;
			ids.push(z.id as string);
		}
		const neu: Todo[] = [];
		for (const id of ids) neu.push(await ladeEines(tx, k, ALLE(k), id));
		return neu;
	});
}

/**
 * Ändert Titel, Beschreibung, Zuständigen, Fälligkeit und/oder `erledigt` (setzt bzw. löscht den Zeitpunkt). Der Zuständige wird
 * nur geprüft, wenn er neu gesetzt wird – ein später deaktivierter Zuständiger blockiert andere Änderungen nicht.
 */
export async function aendereTodo(
	k: Kontext,
	id: string,
	e: Record<string, unknown>,
	sicht: Sicht = ALLE(k)
): Promise<Todo> {
	pruefeId(id);
	const felder = AENDERBAR.filter((f) => Object.hasOwn(e, f));
	const mitErledigt = Object.hasOwn(e, 'erledigt');
	if (felder.length === 0 && !mitErledigt) throw new ApiFehler(400, 'Nichts zu ändern.');
	const erledigt = mitErledigt ? erledigtWert(e.erledigt) : null;
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select t.titel, t.beschreibung, t.lautstaerke, t.schmutz, t.auftrag_id, t.zustaendig_id, to_char(t.faellig, 'YYYY-MM-DD') as faellig, t.erledigt_am,
				t.serie_id
			from ${tx.unsafe(VON)}
			where t.id = ${id} and t.betrieb_id = ${k.betriebId} and ${todoSichtbar(tx, sicht)} for update of t`;
		if (!alt) throw nichtGefunden();
		const w = pruefeTodoEingabe({
			titel: alt.titel,
			beschreibung: alt.beschreibung,
			lautstaerke: alt.lautstaerke,
			schmutz: alt.schmutz,
			zustaendigId: alt.zustaendig_id,
			faellig: alt.faellig,
			...Object.fromEntries(felder.map((f) => [f, e[f]]))
		});
		if (felder.includes('zustaendigId') && w.zustaendigId !== alt.zustaendig_id) {
			await pruefeZustaendig(tx, k, w.zustaendigId);
		}
		await tx`
			update app.todos set titel = ${w.titel}, beschreibung = ${w.beschreibung},
				lautstaerke = ${w.lautstaerke}, schmutz = ${w.schmutz}, zustaendig_id = ${w.zustaendigId}, faellig = ${w.faellig}
				${erledigt === null ? tx`` : erledigt ? tx`, erledigt_am = coalesce(erledigt_am, now())` : tx`, erledigt_am = null`}
			where id = ${id} and betrieb_id = ${k.betriebId}`;
		if (erledigt === true && alt.erledigt_am === null) await naechsteInstanz(tx, k, id);
		return ladeEines(tx, k, sicht, id);
	});
}

/**
 * Abhaken/Öffnen durch den Zuständigen selbst (Recht `auftraege.lesen` genügt). Nicht sichtbar → 404; sichtbar,
 * aber jemand anderem zugewiesen → 403.
 */
export async function setzeErledigt(k: Kontext, sicht: Sicht, id: string, erledigt: boolean): Promise<Todo> {
	pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const t = await ladeEines(tx, k, sicht, id);
		if (t.zustaendigId !== k.benutzerId) throw new ApiFehler(403, 'Nur der Zuständige kann dieses To-do abhaken.');
		await tx`
			update app.todos set erledigt_am = ${erledigt ? tx`coalesce(erledigt_am, now())` : null}
			where id = ${id} and betrieb_id = ${k.betriebId} and zustaendig_id = ${k.benutzerId}`;
		if (erledigt && !t.erledigt) await naechsteInstanz(tx, k, id);
		return ladeEines(tx, k, sicht, id);
	});
}

function regelOder400(e: { regel: unknown; intervall: unknown; ende: unknown }, startTag: string) {
	try {
		return pruefeRegel(e, startTag);
	} catch (f) {
		throw new ApiFehler(400, (f as Error).message);
	}
}

/**
 * Nach dem Abhaken eines Serien-To-dos (in derselben Transaktion): nächste Instanz anlegen – gleicher Auftrag,
 * Zuständiger, Titel, Beschreibung, Stufen; Fälligkeit nach der Regel (nach heute). Nicht, wenn die Serie beendet ist,
 * das Ende überschritten wäre oder schon eine offene Instanz existiert (z. B. erneut geöffnet und wieder abgehakt).
 * Hinweis: Rechte für das neue To-do sind die des abgehakten (das Anlegen erfolgt im Namen des Betriebs).
 */
async function naechsteInstanz(tx: TransactionSql, k: Kontext, todoId: string): Promise<void> {
	const [t] = await tx`
		select t.titel, t.beschreibung, t.auftrag_id, t.zustaendig_id, t.lautstaerke, t.schmutz, t.serie_id,
			to_char(t.faellig, 'YYYY-MM-DD') as faellig, s.regel, s.intervall, to_char(s.start_tag, 'YYYY-MM-DD') as start_tag,
			to_char(s.ende, 'YYYY-MM-DD') as ende, s.aktiv
		from app.todos t join app.todo_serien s on s.id = t.serie_id and s.betrieb_id = t.betrieb_id
		where t.id = ${todoId} and t.betrieb_id = ${k.betriebId}
		for update of s`;
	if (!t || !t.aktiv || !istRegel(t.regel)) return;
	const [offen] = await tx`
		select 1 from app.todos where serie_id = ${t.serie_id} and betrieb_id = ${k.betriebId} and erledigt_am is null limit 1`;
	if (offen) return;
	const heute = berlinTag(new Date());
	const naechster = naechsterTermin(t.faellig ?? heute, { regel: t.regel as Regel, intervall: Number(t.intervall), startTag: t.start_tag }, heute);
	if (t.ende && naechster > t.ende) return;
	// Zuständiger inzwischen deaktiviert → neue Instanz ohne Zuständigen
	const [aktiv] = t.zustaendig_id
		? await tx`select 1 from app.benutzer where id = ${t.zustaendig_id} and betrieb_id = ${k.betriebId} and aktiv`
		: [];
	await tx`
		insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig, lautstaerke, schmutz, serie_id)
		values (${k.betriebId}, ${t.auftrag_id}, ${t.titel}, ${t.beschreibung}, ${aktiv ? t.zustaendig_id : null}, ${naechster},
			${t.lautstaerke}, ${t.schmutz}, ${t.serie_id})`;
}

/** Serie eines To-dos beenden (keine neuen Instanzen mehr; bestehende bleiben). Nicht sichtbar → 404. */
export async function beendeSerie(k: Kontext, todoId: string, sicht: Sicht = ALLE(k)): Promise<Todo> {
	pruefeId(todoId);
	return mitBetrieb(k, async (tx) => {
		const t = await ladeEines(tx, k, sicht, todoId);
		if (!t.serie) throw new ApiFehler(400, 'Dieses To-do wiederholt sich nicht.');
		await tx`update app.todo_serien set aktiv = false where id = ${t.serie.id} and betrieb_id = ${k.betriebId}`;
		return ladeEines(tx, k, sicht, todoId);
	});
}

export async function loescheTodo(k: Kontext, id: string, sicht: Sicht = ALLE(k)): Promise<void> {
	pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [da] = await tx`
			select t.id from ${tx.unsafe(VON)}
			where t.id = ${id} and t.betrieb_id = ${k.betriebId} and ${todoSichtbar(tx, sicht)} for update of t`;
		if (!da) throw nichtGefunden();
		const z = await tx`delete from app.todos where id = ${id} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
	});
}

/**
 * Ein To-do ändern mit den Rechten des Nutzers: Mit `auftraege.bearbeiten` alles (`aendereTodo`), sonst nur
 * `{ erledigt }` am eigenen To-do (`setzeErledigt`); jedes andere Feld → 403.
 */
export async function aendereTodoAls(
	k: Kontext,
	sicht: Sicht,
	darfBearbeiten: boolean,
	id: string,
	e: Record<string, unknown>
): Promise<Todo> {
	if (darfBearbeiten) return aendereTodo(k, id, e, sicht);
	const schluessel = Object.keys(e);
	if (schluessel.length !== 1 || schluessel[0] !== 'erledigt') throw new ApiFehler(403, 'Keine Berechtigung');
	return setzeErledigt(k, sicht, id, erledigtWert(e.erledigt));
}

/** Aktive Mitarbeiter des Betriebs (Auswahl „Zuständig“), nach Name. */
export async function aktiveMitarbeiter(k: Kontext): Promise<{ id: string; name: string }[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select id, name from app.benutzer where betrieb_id = ${k.betriebId} and aktiv
			order by public.unaccent(lower(name)), id`;
		return z.map((b) => ({ id: b.id as string, name: b.name as string }));
	});
}
