<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import KachelBoard from './KachelBoard.svelte';
	import type { KachelSpalte } from '$lib/kachel-board';
	import { todoSpalte, todoVerschiebung, TODO_SPALTEN, type TodoSpalte } from '$lib/todo-board';
	import { tagDeutsch } from '$lib/zeit';
	import { STUFEN, STUFE_NAMEN, stufeName } from '$lib/stufen';

	type Todo = {
		id: string;
		titel: string;
		beschreibung?: string | null;
		lautstaerke?: number | null;
		schmutz?: number | null;
		mirDirekt?: boolean;
		serie?: { id: string; text: string; aktiv: boolean } | null;
		nachfassAngebotId?: string | null;
		auftragId: string | null;
		auftragNummer: string | null;
		auftragTitel: string | null;
		zustaendigId: string | null;
		zustaendigName: string | null;
		faellig: string | null;
		faelligZeit?: string | null;
		erledigt: boolean;
	};

	/**
	 * Aufgaben-Board – gleiches Kachel-Board wie bei den Aufträgen (`KachelBoard`): Spalten Offen, In Arbeit, Erledigt.
	 * Ziehen (ab 700 px) oder Menü „Status ▾“ verschiebt sofort (optimistisch) und speichert über die API; bei einem
	 * Fehler geht die Karte zurück. „In Arbeit“ heißt wie bisher: offen mit Fälligkeit (beim Verschieben: heute).
	 */
	let {
		todos,
		heute,
		benutzerId,
		darfBearbeiten = false,
		mitarbeiter = [],
		zeigeAuftrag = true,
		zeigeQuelle = false,
		aktionen,
		leer = 'Keine Aufgaben.'
	}: {
		todos: Todo[];
		heute: string;
		benutzerId: string;
		darfBearbeiten?: boolean;
		mitarbeiter?: { id: string; name: string }[];
		zeigeAuftrag?: boolean;
		/** „Meine Aufgaben“: kennzeichnen, was nur über einen Auftrag (Zuständig) hier steht. */
		zeigeQuelle?: boolean;
		aktionen: { umschalten: string; aendern: string; loeschen: string; serieBeenden?: string };
		leer?: string;
	} = $props();

	// Lokaler Zustand (optimistisch); neue Daten vom Server ersetzen ihn
	let liste = $derived(todos);
	let meldung = $state('');
	let fehler = $state(false);
	let laeuft = $state<Set<string>>(new Set());

	const spalten = $derived<KachelSpalte<Todo>[]>(
		TODO_SPALTEN.map((s) => ({ ...s, karten: liste.filter((t) => todoSpalte(t) === s.id) }))
	);
	const SPALTEN_NAMEN = Object.fromEntries(TODO_SPALTEN.map((s) => [s.id, s.titel])) as Record<TodoSpalte, string>;

	const ueberfaellig = (t: Todo) => !t.erledigt && t.faellig !== null && t.faellig < heute;

	async function verschiebe(t: Todo, nach: TodoSpalte) {
		if (!darfBearbeiten || laeuft.has(t.id) || todoSpalte(t) === nach) return;
		const vorher = { faellig: t.faellig, erledigt: t.erledigt };
		const aenderung = todoVerschiebung(t, nach, heute);
		liste = liste.map((x) => (x.id === t.id ? { ...x, ...aenderung } : x));
		laeuft = new Set([...laeuft, t.id]);
		fehler = false;
		meldung = `„${t.titel}“ wird nach „${SPALTEN_NAMEN[nach]}“ verschoben …`;
		try {
			const r = await fetch(`/api/todos/${t.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(aenderung)
			});
			const koerper = await r.json().catch(() => null);
			if (!r.ok) throw new Error(koerper?.fehler ?? `Fehler ${r.status}`);
			meldung = `„${t.titel}“ ist jetzt „${SPALTEN_NAMEN[nach]}“.`;
			// Neu laden: z. B. legt das Abhaken eines wiederkehrenden Aufgaben das nächste an
			await invalidateAll();
		} catch (e) {
			liste = liste.map((x) => (x.id === t.id ? { ...x, ...vorher } : x));
			fehler = true;
			meldung = `„${t.titel}“ konnte nicht verschoben werden: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`;
		} finally {
			const neu = new Set(laeuft);
			neu.delete(t.id);
			laeuft = neu;
		}
	}

	function waehle(ev: Event, t: Todo, nach: TodoSpalte) {
		(ev.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
		void verschiebe(t, nach);
	}
</script>

{#snippet kachel(todo: Todo)}
	{@const darfHaken = darfBearbeiten || todo.zustaendigId === benutzerId}
	<div class="kanban-karte" class:ueberfaellig={ueberfaellig(todo)} class:laeuft={laeuft.has(todo.id)}>
		<div class="karte-inhalt">
			<div class="td-kopf">
				<p class="td-titel">{todo.titel}</p>
				{#if darfBearbeiten}
					<details class="ab-menue">
						<summary aria-label={`Status von „${todo.titel}“ ändern`}>Status ▾</summary>
						<div class="ab-menue-liste">
							{#each TODO_SPALTEN.filter((s) => s.id !== todoSpalte(todo)) as s (s.id)}
								<button type="button" onclick={(ev) => waehle(ev, todo, s.id)} disabled={laeuft.has(todo.id)}>Nach „{s.titel}“</button>
							{/each}
						</div>
					</details>
				{/if}
			</div>
			{#if todo.beschreibung}
				<p class="karte-beschreibung">{todo.beschreibung}</p>
			{/if}
			{#if todo.serie}
				<p class="karte-serie" class:beendet={!todo.serie.aktiv}>
					{todo.serie.aktiv ? `Wiederholt sich: ${todo.serie.text}` : 'Wiederholung beendet'}
				</p>
			{/if}
			{#if todo.nachfassAngebotId}
				<p class="karte-auftrag"><a href={`/angebote/${todo.nachfassAngebotId}#nachfassen`} draggable="false">Mailtext im Angebot öffnen</a></p>
			{/if}
			{#if todo.lautstaerke || todo.schmutz}
				<p class="karte-stufen">
					{#if todo.lautstaerke}<span class={`stufe-${todo.lautstaerke}`}>Lautstärke: {stufeName(todo.lautstaerke)}</span>{/if}
					{#if todo.schmutz}<span class={`stufe-${todo.schmutz}`}>Schmutz: {stufeName(todo.schmutz)}</span>{/if}
				</p>
			{/if}
			{#if zeigeAuftrag && todo.auftragNummer}
				<p class="karte-auftrag">
					{#if todo.auftragId}<a href={`/auftraege/${todo.auftragId}`} draggable="false">{todo.auftragNummer}</a>{:else}{todo.auftragNummer}{/if}{zeigeQuelle && todo.mirDirekt === false ? ' · über den Auftrag (du bist zuständig)' : ''}
				</p>
			{/if}
			{#if darfBearbeiten}
				<details class="karte-bearbeiten">
					<summary>Bearbeiten</summary>
					<form method="POST" action={aktionen.aendern} use:enhance class="karte-formular">
						<input type="hidden" name="id" value={todo.id} />
						<label>Titel <input type="text" name="titel" maxlength="200" required value={todo.titel} /></label>
						<label>
							Beschreibung
							<textarea name="beschreibung" maxlength="500" rows="2">{todo.beschreibung ?? ''}</textarea>
						</label>
						<div class="karte-zwei">
							<label>
								Lautstärke
								<Auswahl name="lautstaerke">
									<option value="" selected={!todo.lautstaerke}>–</option>
									{#each STUFEN as n (n)}<option value={String(n)} selected={todo.lautstaerke === n}>{STUFE_NAMEN[n]}</option>{/each}
								</Auswahl>
							</label>
							<label>
								Schmutz
								<Auswahl name="schmutz">
									<option value="" selected={!todo.schmutz}>–</option>
									{#each STUFEN as n (n)}<option value={String(n)} selected={todo.schmutz === n}>{STUFE_NAMEN[n]}</option>{/each}
								</Auswahl>
							</label>
						</div>
						<button type="submit" class="kd-knopf">Speichern</button>
					</form>
					{#if todo.serie?.aktiv && aktionen.serieBeenden}
						<form method="POST" action={aktionen.serieBeenden} use:enhance>
							<input type="hidden" name="id" value={todo.id} />
							<button type="submit" class="kd-knopf hell">Wiederholung beenden</button>
						</form>
					{/if}
				</details>
			{/if}
			<div class="karte-meta">
				{#if todo.zustaendigName}
					<span class="karte-zustaendig">
						<span class="avatar">{todo.zustaendigName.charAt(0)}</span>
						{todo.zustaendigName}
					</span>
				{/if}
				{#if todo.faellig}
					<span class="karte-faellig" class:ueberfaellig={ueberfaellig(todo)}>
						{tagDeutsch(todo.faellig)}{todo.faelligZeit ? ` ${todo.faelligZeit}` : ''}
					</span>
				{/if}
			</div>
		</div>
		{#if darfHaken}
			<form method="POST" action={aktionen.umschalten} use:enhance class="karte-haken">
				<input type="hidden" name="id" value={todo.id} />
				<input type="hidden" name="erledigt" value={todo.erledigt ? 'false' : 'true'} />
				<button type="submit" class="haken-knopf" class:erledigt={todo.erledigt} aria-label={todo.erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}>
					{#if todo.erledigt}✓{/if}
				</button>
			</form>
		{/if}
	</div>
{/snippet}

{#snippet geist(t: Todo)}
	<strong>{t.titel}</strong>
	{#if t.zustaendigName}<span class="karte-zustaendig">{t.zustaendigName}</span>{/if}
{/snippet}

<KachelBoard
	{spalten}
	ziehbar={() => darfBearbeiten}
	onablegen={(t, _von, nach) => void verschiebe(t, nach as TodoSpalte)}
	karte={kachel}
	{geist}
	{meldung}
	{fehler}
	{leer}
	reiterLabel="Spalte wählen"
/>

<style>
	.kanban-karte {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.kanban-karte.laeuft {
		opacity: 0.7;
	}
	.kanban-karte.ueberfaellig {
		border-left: 3px solid var(--m365-fehler);
		margin-left: -0.7rem;
		padding-left: calc(0.7rem - 3px);
	}
	.td-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.karte-auftrag a {
		color: var(--ui-akzent-text);
	}
	.ab-menue {
		position: relative;
		flex: none;
	}
	.ab-menue summary {
		display: inline-flex;
		align-items: center;
		min-height: 2rem;
		padding: 0 0.5rem;
		border-radius: var(--m365-radius);
		font-size: 0.75rem;
		color: var(--ui-akzent-text);
		cursor: pointer;
		list-style: none;
	}
	.ab-menue summary::-webkit-details-marker {
		display: none;
	}
	.ab-menue summary:hover {
		background: var(--m365-flaeche-hover);
	}
	/* Menü klappt in der Karte auf (nicht schwebend): lange Spalten scrollen in sich und würden es abschneiden */
	.ab-menue[open] {
		flex-basis: 100%;
		text-align: right;
	}
	.ab-menue-liste {
		margin-top: 0.25rem;
		text-align: left;
		display: grid;
		min-width: 0;
		padding: 0.25rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten-hoch);
	}
	.ab-menue-liste button {
		min-height: var(--tippziel, 44px);
		padding: 0 0.75rem;
		border: 0;
		border-radius: var(--m365-radius);
		background: transparent;
		color: var(--m365-text);
		font: inherit;
		font-size: 0.8125rem;
		text-align: left;
		cursor: pointer;
	}
	.ab-menue-liste button:hover,
	.ab-menue-liste button:focus-visible {
		background: var(--m365-primaer-hell);
	}

	.karte-inhalt {
		flex: 1;
		min-width: 0;
	}

	.td-titel {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--m365-text);
		line-height: 1.3;
	}

	.karte-beschreibung {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--m365-text-leise);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.karte-bearbeiten summary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		font-family: var(--m365-schrift);
		font-size: 0.75rem;
		color: var(--ui-akzent-text);
		cursor: pointer;
	}
	.karte-formular {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
		font-size: 0.8125rem;
	}
	.karte-formular label {
		display: grid;
		gap: 0.15rem;
	}
	.karte-formular input,
	.karte-formular select,
	.karte-formular textarea {
		min-height: 2.25rem;
		font: inherit;
	}
	.karte-zwei {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.karte-serie {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.75rem;
		color: var(--ui-akzent-text);
	}
	.karte-serie.beendet {
		color: var(--m365-text-leise);
	}

	.karte-stufen {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0 0 0.25rem;
	}
	.karte-stufen span {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--m365-flaeche-hover);
		color: var(--m365-text);
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
	}

	.karte-stufen .stufe-2 {
		background: var(--m365-warnung-hell);
	}
	.karte-stufen .stufe-3 {
		background: var(--m365-fehler-hell);
		color: var(--m365-fehler);
	}

	.karte-auftrag {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
		color: var(--m365-text-leise);
	}

	.karte-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.karte-zustaendig {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
		color: var(--m365-text-leise);
	}

	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
		font-family: var(--m365-schrift);
		font-size: 0.5625rem;
		font-weight: 600;
	}

	.karte-faellig {
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
		color: var(--m365-text-leise);
	}

	.karte-faellig.ueberfaellig {
		color: var(--m365-fehler);
		font-weight: 600;
	}

	.karte-haken {
		margin: 0;
	}

	/* Planner-Haken-Checkbox */
	.haken-knopf {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		min-width: 1.25rem;
		min-height: 1.25rem;
		margin-top: 0.125rem;
		border: 1.5px solid var(--m365-rand-stark);
		border-radius: 50%;
		background: var(--m365-flaeche);
		color: transparent;
		font-size: 0.625rem;
		cursor: pointer;
		transition: border-color 150ms, background 150ms, color 150ms;
	}

	.haken-knopf:hover {
		border-color: var(--m365-primaer);
	}

	.haken-knopf.erledigt {
		background: var(--m365-primaer);
		border-color: var(--m365-primaer);
		color: var(--ui-akzent-auf);
	}
</style>
