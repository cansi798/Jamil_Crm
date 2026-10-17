<script lang="ts">
	import { enhance } from '$app/forms';
	import { tagDeutsch } from '$lib/zeit';

	type Todo = {
		id: string;
		titel: string;
		auftragId: string | null;
		auftragNummer: string | null;
		auftragTitel: string | null;
		zustaendigId: string | null;
		zustaendigName: string | null;
		faellig: string | null;
		erledigt: boolean;
	};

	type Spalte = {
		id: string;
		titel: string;
		farbe: string;
	};

	/**
	 * Kanban-Board im Microsoft-Planner-Stil. Drei Spalten: Offen, In Arbeit, Erledigt.
	 * To-dos werden per Drag & Drop zwischen den Spalten verschoben (HTML5 Drag & Drop API).
	 */
	let {
		todos,
		heute,
		benutzerId,
		darfBearbeiten = false,
		mitarbeiter = [],
		zeigeAuftrag = true,
		aktionen,
		leer = 'Keine To-dos.'
	}: {
		todos: Todo[];
		heute: string;
		benutzerId: string;
		darfBearbeiten?: boolean;
		mitarbeiter?: { id: string; name: string }[];
		zeigeAuftrag?: boolean;
		aktionen: { umschalten: string; aendern: string; loeschen: string };
		leer?: string;
	} = $props();

	const spalten: Spalte[] = [
		{ id: 'offen', titel: 'Offen', farbe: '#616161' },
		{ id: 'in-arbeit', titel: 'In Arbeit', farbe: '#0078d4' },
		{ id: 'erledigt', titel: 'Erledigt', farbe: '#107c10' }
	];

	// To-dos den Spalten zuordnen
	const spaltenTodos = $derived({
		offen: todos.filter((t) => !t.erledigt && !t.faellig),
		'in-arbeit': todos.filter((t) => !t.erledigt && t.faellig),
		erledigt: todos.filter((t) => t.erledigt)
	});

	const ueberfaellig = (t: Todo) => !t.erledigt && t.faellig !== null && t.faellig < heute;

	// Drag & Drop
	let dragTodoId = $state<string | null>(null);
	let dragOverSpalte = $state<string | null>(null);

	function dragStart(e: DragEvent, todoId: string) {
		dragTodoId = todoId;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', todoId);
		}
	}

	function dragOver(e: DragEvent, spalteId: string) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		dragOverSpalte = spalteId;
	}

	function dragLeave() {
		dragOverSpalte = null;
	}

	function drop(e: DragEvent, spalteId: string) {
		e.preventDefault();
		dragOverSpalte = null;
		if (!dragTodoId) return;

		const todo = todos.find((t) => t.id === dragTodoId);
		if (!todo) return;

		// Status ändern basierend auf Zielspalte
		const neuesErledigt = spalteId === 'erledigt';
		if (todo.erledigt !== neuesErledigt) {
			// Formular abschicken um Status zu ändern
			const form = document.createElement('form');
			form.method = 'POST';
			form.action = aktionen.umschalten;
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = 'id';
			input.value = dragTodoId;
			form.appendChild(input);
			document.body.appendChild(form);
			form.submit();
		}

		dragTodoId = null;
	}
</script>

<div class="kanban">
	{#each spalten as spalte (spalte.id)}
		<div
			class="kanban-spalte"
			class:drag-over={dragOverSpalte === spalte.id}
			role="region"
			aria-label={spalte.titel}
			ondragover={(e) => dragOver(e, spalte.id)}
			ondragleave={dragLeave}
			ondrop={(e) => drop(e, spalte.id)}
		>
			<div class="spalte-kopf" style="--spalte-farbe: {spalte.farbe}">
				<span class="spalte-indikator"></span>
				<h3 class="spalte-titel">{spalte.titel}</h3>
				<span class="spalte-anzahl">{spaltenTodos[spalte.id as keyof typeof spaltenTodos].length}</span>
			</div>

			<div class="spalte-inhalt">
				{#each spaltenTodos[spalte.id as keyof typeof spaltenTodos] as todo (todo.id)}
					{@const darfHaken = darfBearbeiten || todo.zustaendigId === benutzerId}
					<div
						class="kanban-karte"
						class:ueberfaellig={ueberfaellig(todo)}
						role="listitem"
						draggable={darfBearbeiten}
						ondragstart={(e) => dragStart(e, todo.id)}
					>
						<div class="karte-inhalt">
							<p class="karte-titel">{todo.titel}</p>
							{#if zeigeAuftrag && todo.auftragNummer}
								<p class="karte-auftrag">{todo.auftragNummer}</p>
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
										{tagDeutsch(todo.faellig)}
									</span>
								{/if}
							</div>
						</div>
						{#if darfHaken}
							<form method="POST" action={aktionen.umschalten} use:enhance class="karte-haken">
								<input type="hidden" name="id" value={todo.id} />
								<button type="submit" class="haken-knopf" class:erledigt={todo.erledigt} aria-label={todo.erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}>
									{#if todo.erledigt}✓{/if}
								</button>
							</form>
						{/if}
					</div>
				{:else}
					<p class="spalte-leer">{leer}</p>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.kanban {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		padding: 1rem 0;
	}

	@media (max-width: 768px) {
		.kanban {
			grid-template-columns: 1fr;
		}
	}

	.kanban-spalte {
		background: var(--m365-hintergrund);
		border: 2px solid transparent;
		border-radius: var(--m365-radius-gross);
		padding: 0.75rem;
		min-height: 200px;
		transition: border-color 150ms, background 150ms;
	}

	.kanban-spalte.drag-over {
		border-color: var(--m365-primaer);
		background: var(--m365-primaer-hell);
	}

	.spalte-kopf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--m365-rand);
	}

	.spalte-indikator {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--spalte-farbe);
	}

	.spalte-titel {
		margin: 0;
		font-family: var(--m365-schrift);
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--m365-text);
		flex: 1;
	}

	.spalte-anzahl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		padding: 0 0.5rem;
		border-radius: 12px;
		background: var(--m365-rand);
		color: var(--m365-text-leise);
		font-family: var(--m365-schrift);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.spalte-inhalt {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.spalte-leer {
		margin: 0;
		padding: 1rem;
		text-align: center;
		color: var(--m365-text-leise);
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
	}

	.kanban-karte {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--m365-flaeche);
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		box-shadow: var(--m365-schatten);
		cursor: grab;
		transition: box-shadow 150ms, transform 150ms;
	}

	.kanban-karte:hover {
		box-shadow: var(--m365-schatten-hoch);
	}

	.kanban-karte:active {
		cursor: grabbing;
	}

	.kanban-karte.ueberfaellig {
		border-left: 3px solid var(--m365-fehler);
	}

	.karte-inhalt {
		flex: 1;
		min-width: 0;
	}

	.karte-titel {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--m365-text);
		line-height: 1.3;
	}

	.karte-auftrag {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.75rem;
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
		font-size: 0.75rem;
		color: var(--m365-text-leise);
	}

	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--m365-primaer-hell);
		color: var(--m365-primaer);
		font-family: var(--m365-schrift);
		font-size: 0.625rem;
		font-weight: 600;
	}

	.karte-faellig {
		font-family: var(--m365-schrift);
		font-size: 0.75rem;
		color: var(--m365-text-leise);
	}

	.karte-faellig.ueberfaellig {
		color: var(--m365-fehler);
		font-weight: 600;
	}

	.karte-haken {
		margin: 0;
	}

	.haken-knopf {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: 2px solid var(--m365-rand);
		border-radius: 4px;
		background: var(--m365-flaeche);
		color: var(--m365-erfolg);
		font-size: 0.875rem;
		cursor: pointer;
		transition: border-color 150ms, background 150ms;
	}

	.haken-knopf:hover {
		border-color: var(--m365-primaer);
	}

	.haken-knopf.erledigt {
		background: var(--m365-erfolg);
		border-color: var(--m365-erfolg);
		color: #fff;
	}
</style>