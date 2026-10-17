<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	export let data: PageData;
	export let form: ActionData;

	let bearbeiten = false;
	let todos: { titel: string; beschreibung: string }[] = [];

	$: if (data.vorlage) {
		todos = data.vorlage.todos.map((t) => ({ titel: t.titel, beschreibung: t.beschreibung ?? '' }));
	}

	function todoHinzufuegen() {
		todos = [...todos, { titel: '', beschreibung: '' }];
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

	function abbrechen() {
		bearbeiten = false;
		todos = data.vorlage.todos.map((t) => ({ titel: t.titel, beschreibung: t.beschreibung ?? '' }));
	}
</script>

<svelte:head>
	<title>{data.vorlage.name} – CRM</title>
</svelte:head>

<div class="seite">
	<header class="kopf">
		<h1>{data.vorlage.name}</h1>
		{#if data.darfBearbeiten && !bearbeiten}
			<button on:click={() => (bearbeiten = true)} class="knopf">Bearbeiten</button>
		{/if}
	</header>

	{#if form?.fehler}
		<p class="fehler">{form.fehler}</p>
	{/if}

	{#if !bearbeiten}
		<div class="ansicht">
			{#if data.vorlage.beschreibung}
				<p class="beschreibung">{data.vorlage.beschreibung}</p>
			{/if}

			<h2>To-dos ({data.vorlage.todos.length})</h2>
			{#if data.vorlage.todos.length === 0}
				<p class="leer">Keine To-dos vorhanden.</p>
			{:else}
				<ol class="todo-liste">
					{#each data.vorlage.todos as todo (todo.id)}
						<li class="todo-item">
							<strong>{todo.titel}</strong>
							{#if todo.beschreibung}
								<p class="todo-beschreibung">{todo.beschreibung}</p>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{:else}
		<form method="POST" action="?/bearbeiten" use:enhance>
			<div class="feld">
				<label for="name">Name *</label>
				<input type="text" id="name" name="name" value={data.vorlage.name} required maxlength="100" />
			</div>

			<div class="feld">
				<label for="beschreibung">Beschreibung</label>
				<textarea id="beschreibung" name="beschreibung" rows="3" maxlength="500">{data.vorlage.beschreibung ?? ''}</textarea>
			</div>

			<fieldset class="todos">
				<legend>To-dos</legend>
				{#each todos as todo, i (i)}
					<div class="todo">
						<div class="todo-felder">
							<input
								type="text"
								name="todo_{i}"
								placeholder="To-do {i + 1}"
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
						</div>
						<div class="todo-knoepfe">
							<button type="button" on:click={() => todoVerschieben(i, -1)} disabled={i === 0}>↑</button>
							<button type="button" on:click={() => todoVerschieben(i, 1)} disabled={i === todos.length - 1}>↓</button>
							<button type="button" on:click={() => todoEntfernen(i)} class="entfernen">×</button>
						</div>
					</div>
				{/each}
				<button type="button" on:click={todoHinzufuegen} class="hinzufuegen">+ To-do hinzufügen</button>
			</fieldset>

			<div class="knoepfe">
				<button type="button" on:click={abbrechen} class="knopf">Abbrechen</button>
				<button type="submit" class="knopf prima">Speichern</button>
			</div>
		</form>
	{/if}

	{#if data.darfBearbeiten && !bearbeiten}
		<form method="POST" action="?/loeschen" use:enhance class="loeschen-form" on:submit|preventDefault={(e) => {
			if (confirm('Vorlage wirklich löschen?')) {
				(e.target as HTMLFormElement).submit();
			}
		}}>
			<button type="submit" class="knopf gefahr">Löschen</button>
		</form>
	{/if}
</div>

<style>
	.seite {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.kopf {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--text, #323130);
	}
	h2 {
		font-size: 1.125rem;
		color: var(--text, #323130);
		margin: 1.5rem 0 0.75rem;
	}
	.fehler {
		background: #fde7e9;
		color: #a4262c;
		padding: 0.75rem;
		border-radius: 4px;
		margin-bottom: 1rem;
	}
	.beschreibung {
		color: var(--text-leise, #605e5c);
		margin-bottom: 1rem;
	}
	.leer {
		color: var(--text-leise, #605e5c);
	}
	.todo-liste {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.todo-item {
		padding: 0.75rem;
		background: var(--karte-hintergrund, white);
		border-radius: 4px;
		margin-bottom: 0.5rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}
	.todo-beschreibung {
		margin: 0.25rem 0 0;
		color: var(--text-leise, #605e5c);
		font-size: 0.875rem;
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
		outline: 2px solid var(--primar, #0078d4);
		outline-offset: -1px;
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
		border-color: var(--primar, #0078d4);
		color: var(--primar, #0078d4);
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
		background: var(--primar, #0078d4);
		color: white;
		border-color: var(--primar, #0078d4);
	}
	.knopf.prima:hover {
		background: var(--primar-dunkel, #106ebe);
	}
	.knopf.gefahr {
		background: #a4262c;
		color: white;
		border-color: #a4262c;
	}
	.knopf.gefahr:hover {
		background: #8e1e24;
	}
	.loeschen-form {
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid #d2d0ce;
	}
</style>
