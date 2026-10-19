<script lang="ts">
	import { enhance } from '$app/forms';
	import { tagDeutsch } from '$lib/zeit';

	type Todo = {
		id: string;
		titel: string;
		beschreibung?: string | null;
		lautstaerke?: number | null;
		schmutz?: number | null;
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
	 * To-dos werden per Pointer-Events (Touch + Maus) zwischen den Spalten verschoben.
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

	// ── Drag & Drop (Pointer Events: funktioniert auf Touch UND Maus) ──
	let dragTodoId = $state<string | null>(null);
	let dragOverSpalte = $state<string | null>(null);
	let dragStartX = $state(0);
	let dragStartY = $state(0);
	let dragAktiv = $state(false);
	let dragAktuellerSpalte = $state<string | null>(null);

	const SCHWELLE = 8; // px, bevor Drag als Absicht gilt

	function pointerDown(e: PointerEvent, todoId: string, spalteId: string) {
		if (!darfBearbeiten) return;
		if (e.button !== 0) return; // nur linke Maustaste / Touch
		// In Formularfeldern und Knöpfen der Karte (z. B. „Bearbeiten“) nie ziehen
		if ((e.target as Element).closest('input, select, textarea, button, summary, a, label, form')) return;
		dragTodoId = todoId;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragAktiv = false;
		dragAktuellerSpalte = spalteId;
	}

	function pointerMove(e: PointerEvent) {
		if (!dragTodoId) return;
		const dx = Math.abs(e.clientX - dragStartX);
		const dy = Math.abs(e.clientY - dragStartY);
		if (!dragAktiv && (dx > SCHWELLE || dy > SCHWELLE)) {
			dragAktiv = true;
			// Pointer Capture, damit der Rest des Viewports nicht scrollt
			(e.target as Element).setPointerCapture?.(e.pointerId);
		}
		if (!dragAktiv) return;

		// Spalte unter dem Pointer finden
		const unter = document.elementFromPoint(e.clientX, e.clientY);
		const spalte = unter?.closest('.kanban-spalte');
		dragOverSpalte = spalte?.getAttribute('data-spalte') ?? null;
	}

	function pointerUp(e: PointerEvent) {
		if (!dragTodoId || !dragAktiv) {
			dragTodoId = null;
			dragAktiv = false;
			dragOverSpalte = null;
			return;
		}
		dragAktiv = false;
		dragOverSpalte = null;

		const todo = todos.find((t) => t.id === dragTodoId);
		if (todo && dragAktuellerSpalte) {
			// Zielspalte bestimmen (wo wurde losgelassen?)
			const unter = document.elementFromPoint(e.clientX, e.clientY);
			const zielSpalte = unter?.closest('.kanban-spalte')?.getAttribute('data-spalte') ?? dragAktuellerSpalte;

			if (zielSpalte !== dragAktuellerSpalte) {
				// Übergang: passende Aktion wählen
				if (zielSpalte === 'erledigt') {
					// → Erledigt: umschalten mit erledigt=true
					absenden(aktionen.umschalten, { id: todo.id, erledigt: 'true' });
				} else if (dragAktuellerSpalte === 'erledigt') {
					// Erledigt → Offen/In Arbeit: erledigt=false + faellig anpassen
					const neuesFaellig = zielSpalte === 'in-arbeit' ? heute : '';
					absenden(aktionen.aendern, { id: todo.id, erledigt: 'false', faellig: neuesFaellig });
				} else {
					// Offen ↔ In Arbeit: nur faellig ändern (erledigt bleibt false)
					const neuesFaellig = zielSpalte === 'in-arbeit' ? heute : '';
					absenden(aktionen.aendern, { id: todo.id, faellig: neuesFaellig });
				}
			}
		}

		dragTodoId = null;
		dragAktuellerSpalte = null;
	}

	function pointerCancel() {
		dragTodoId = null;
		dragAktiv = false;
		dragOverSpalte = null;
		dragAktuellerSpalte = null;
	}

	function absenden(aktion: string, felder: Record<string, string>) {
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = aktion;
		for (const [name, wert] of Object.entries(felder)) {
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = name;
			input.value = wert;
			form.appendChild(input);
		}
		document.body.appendChild(form);
		form.submit();
	}
</script>

<svelte:window
	onpointermove={pointerMove}
	onpointerup={pointerUp}
	onpointercancel={pointerCancel}
/>

<div class="kanban">
	{#each spalten as spalte (spalte.id)}
		<div
			class="kanban-spalte"
			class:drag-over={dragOverSpalte === spalte.id}
			role="region"
			aria-label={spalte.titel}
			data-spalte={spalte.id}
		>
			<div class="spalte-kopf" style="--spalte-farbe: {spalte.farbe}">
				<span class="spalte-indikator"></span>
				<h3 class="spalte-titel">{spalte.titel}</h3>
				<span class="spalte-anzahl">{spaltenTodos[spalte.id as keyof typeof spaltenTodos].length}</span>
			</div>

			<div class="spalte-inhalt" role="list">
				{#each spaltenTodos[spalte.id as keyof typeof spaltenTodos] as todo (todo.id)}
					{@const darfHaken = darfBearbeiten || todo.zustaendigId === benutzerId}
					<div
						class="kanban-karte"
						class:ueberfaellig={ueberfaellig(todo)}
						class:drag-aktiv={dragTodoId === todo.id && dragAktiv}
						role="listitem"
						onpointerdown={(e) => pointerDown(e, todo.id, spalte.id)}
					>
						<div class="karte-inhalt">
							<p class="karte-titel">{todo.titel}</p>
							{#if todo.beschreibung}
								<p class="karte-beschreibung">{todo.beschreibung}</p>
							{/if}
							{#if todo.lautstaerke || todo.schmutz}
								<p class="karte-stufen">
									{#if todo.lautstaerke}<span title="Lautstärke {todo.lautstaerke} von 5">Lautstärke {todo.lautstaerke}/5</span>{/if}
									{#if todo.schmutz}<span title="Schmutz {todo.schmutz} von 5">Schmutz {todo.schmutz}/5</span>{/if}
								</p>
							{/if}
							{#if zeigeAuftrag && todo.auftragNummer}
								<p class="karte-auftrag">{todo.auftragNummer}</p>
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
												<select name="lautstaerke">
													<option value="" selected={!todo.lautstaerke}>–</option>
													{#each [1, 2, 3, 4, 5] as n (n)}<option value={String(n)} selected={todo.lautstaerke === n}>{n}</option>{/each}
												</select>
											</label>
											<label>
												Schmutz
												<select name="schmutz">
													<option value="" selected={!todo.schmutz}>–</option>
													{#each [1, 2, 3, 4, 5] as n (n)}<option value={String(n)} selected={todo.schmutz === n}>{n}</option>{/each}
												</select>
											</label>
										</div>
										<button type="submit" class="kd-knopf">Speichern</button>
									</form>
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
										{tagDeutsch(todo.faellig)}
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
				{:else}
					<p class="spalte-leer">{leer}</p>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	/* Kanban im Microsoft-Planner-Stil */
	.kanban {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		padding: 0.5rem 0;
		align-items: start;
	}

	@media (max-width: 768px) {
		.kanban {
			grid-template-columns: 1fr;
		}
	}

	.kanban-spalte {
		background: var(--m365-flaeche-hover);
		border: none;
		border-radius: var(--m365-radius-karte);
		padding: 0.75rem;
		min-height: 250px;
		transition: background 150ms, outline 150ms;
		outline: 2px solid transparent;
		outline-offset: -2px;
	}

	.kanban-spalte.drag-over {
		outline-color: var(--m365-primaer);
		background: var(--m365-primaer-hell);
	}

	.spalte-kopf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		padding: 0.25rem 0.25rem 0.5rem;
	}

	.spalte-indikator {
		display: none;
	}

	.spalte-titel {
		margin: 0;
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--m365-text);
		flex: 1;
	}

	.spalte-anzahl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.375rem;
		border-radius: var(--m365-radius-gross);
		background: var(--m365-rand);
		color: var(--m365-text-leise);
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1;
	}

	.spalte-inhalt {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.spalte-leer {
		margin: 0;
		padding: 1.5rem 0.75rem;
		text-align: center;
		color: var(--m365-text-leicht);
		font-family: var(--m365-schrift);
		font-size: 0.8125rem;
	}

	/* Planner-Karte: weiß, Schatten, abgerundet */
	.kanban-karte {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--m365-flaeche);
		border: none;
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
		cursor: grab;
		touch-action: manipulation;
		user-select: none;
		transition: box-shadow 150ms, transform 150ms;
	}

	.kanban-karte:hover {
		box-shadow: var(--m365-schatten-hoch);
	}

	.kanban-karte:active {
		cursor: grabbing;
	}

	.kanban-karte.drag-aktiv {
		opacity: 0.8;
		box-shadow: var(--m365-schatten-pop);
		transform: scale(1.03);
	}

	.kanban-karte.ueberfaellig {
		border-left: 3px solid var(--m365-fehler);
		padding-left: calc(0.75rem - 3px);
	}

	.karte-inhalt {
		flex: 1;
		min-width: 0;
	}

	.karte-titel {
		margin: 0 0 0.25rem;
		font-family: var(--m365-schrift);
		font-size: 0.8125rem;
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
		color: var(--m365-primaer);
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
		color: #fff;
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
		color: #fff;
	}
</style>