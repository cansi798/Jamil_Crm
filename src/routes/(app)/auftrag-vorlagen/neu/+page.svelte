<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { STUFEN, STUFE_NAMEN } from '$lib/stufen';
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	export let form: ActionData;

	let todos: { titel: string; beschreibung: string; lautstaerke: string; schmutz: string }[] = [{ titel: '', beschreibung: '', lautstaerke: '', schmutz: '' }];

	function todoHinzufuegen() {
		todos = [...todos, { titel: '', beschreibung: '', lautstaerke: '', schmutz: '' }];
	}

	function todoEntfernen(index: number) {
		todos = todos.filter((_, i) => i !== index);
	}

	function todoVerschieben(index: number, richtung: -1 | 1) {
		const ziel = index + richtung;
		if (ziel < 0 || ziel >= todos.length) return;
		const neu = [...todos];
		[neu[index], neu[ziel]] = [neu[ziel], neu[index]];
		todos = neu;
	}
</script>

<svelte:head>
	<title>Neue Vorlage – CRM</title>
</svelte:head>

<div class="seite kd-seite">
	<header class="kopf">
		<h1>Neue Vorlage</h1>
	</header>

	{#if form?.fehler}
		<p class="fehler">{form.fehler}</p>
	{/if}

	<form method="POST" use:enhance>
		<div class="feld">
			<label for="name">Name *</label>
			<input type="text" id="name" name="name" required maxlength="100" />
		</div>

		<div class="feld">
			<label for="beschreibung">Beschreibung</label>
			<textarea id="beschreibung" name="beschreibung" rows="3" maxlength="500"></textarea>
		</div>

		<fieldset class="todos">
			<legend>Aufgaben</legend>
			{#each todos as todo, i (i)}
				<div class="todo">
					<div class="todo-felder">
						<input
							type="text"
							name="todo_{i}"
							placeholder="Aufgabe {i + 1}"
							bind:value={todo.titel}
							required
							maxlength="200"
						/>
						<input
							type="text"
							name="todo_beschreibung_{i}"
							placeholder="Beschreibung (optional)"
							bind:value={todo.beschreibung}
							maxlength="500"
						/>
						<div class="todo-stufen">
							<Auswahl name="todo_lautstaerke_{i}" bind:value={todo.lautstaerke} aria-label="Lautstärke Aufgabe {i + 1}">
								<option value="">Lautstärke –</option>
								{#each STUFEN as n (n)}<option value={String(n)}>Lautstärke: {STUFE_NAMEN[n]}</option>{/each}
							</Auswahl>
							<Auswahl name="todo_schmutz_{i}" bind:value={todo.schmutz} aria-label="Schmutz Aufgabe {i + 1}">
								<option value="">Schmutz –</option>
								{#each STUFEN as n (n)}<option value={String(n)}>Schmutz: {STUFE_NAMEN[n]}</option>{/each}
							</Auswahl>
						</div>
					</div>
					<div class="todo-knoepfe">
						<button type="button" class="knopf-ghost" aria-label="Nach oben" on:click={() => todoVerschieben(i, -1)} disabled={i === 0}>↑</button>
						<button type="button" class="knopf-ghost" aria-label="Nach unten" on:click={() => todoVerschieben(i, 1)} disabled={i === todos.length - 1}>↓</button>
						<button type="button" on:click={() => todoEntfernen(i)} class="kd-knopf gefahr" aria-label="Entfernen">×</button>
					</div>
				</div>
			{/each}
			<button type="button" on:click={todoHinzufuegen} class="kd-knopf hell">+ Aufgabe hinzufügen</button>
		</fieldset>

		<div class="knoepfe form-fuss-rechts">
			<a href="/auftrag-vorlagen" class="kd-knopf hell">Abbrechen</a>
			<button type="submit" class="kd-knopf">Speichern</button>
		</div>
	</form>
</div>

<style>
	.seite {
		max-width: none; /* ganze Arbeitsfläche (Jamil msg 2838) */
		margin: 0;
		padding: 1rem;
	}
	.kopf {
		margin-bottom: 1.5rem;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--text, #323130);
	}
	.fehler {
		background: #fde7e9;
		color: #a4262c;
		padding: 0.75rem;
		border-radius: 4px;
		margin-bottom: 1rem;
	}
	.feld {
		margin-bottom: 1rem;
	}
	label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
		color: var(--text, #323130);
	}
	input, textarea {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		font-size: 1rem;
		box-sizing: border-box;
	}
	input:focus, textarea:focus {
		outline: 2px solid var(--m365-primaer);
		outline-offset: -1px;
	}
	.todo-stufen {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.todo-stufen select {
		padding: 0.5rem;
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		font-size: 0.9rem;
	}
	.todos {
		border: 1px solid #d2d0ce;
		border-radius: 4px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	legend {
		font-weight: 600;
		color: var(--text, #323130);
		padding: 0 0.5rem;
	}
	.todo {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		align-items: flex-start;
	}
	.todo-felder {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.todo-knoepfe {
		display: flex;
		gap: 0.25rem;
	}
	.todo-knoepfe button {
		width: 32px;
		height: 32px;
		border: 1px solid #d2d0ce;
		background: white;
		border-radius: 4px;
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
	}
	.todo-knoepfe button:hover:not(:disabled) {
		background: #f3f2f1;
	}
	.todo-knoepfe button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.entfernen {
		color: #a4262c;
	}
	.hinzufuegen {
		width: 100%;
		padding: 0.5rem;
		border: 2px dashed #d2d0ce;
		background: transparent;
		border-radius: 4px;
		cursor: pointer;
		color: var(--text-leise, #605e5c);
		font-size: 1rem;
	}
	.hinzufuegen:hover {
		border-color: var(--m365-primaer);
		color: var(--ui-akzent-text);
	}
	.knoepfe {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
	.knopf {
		display: inline-block;
		padding: 0.5rem 1rem;
		border: 1px solid #d2d0ce;
		background: white;
		color: var(--text, #323130);
		text-decoration: none;
		border-radius: 4px;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.knopf.prima {
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
		border-color: var(--m365-primaer);
	}
	.knopf.prima:hover {
		background: var(--ui-akzent-hover);
	}
</style>
