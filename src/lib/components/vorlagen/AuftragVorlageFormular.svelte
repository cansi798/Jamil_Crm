<script lang="ts">
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { STUFEN, STUFE_NAMEN } from '$lib/stufen';

	/**
	 * Formular einer Auftrags-Vorlage – gleich für „Neue Vorlage“ und „Bearbeiten“ (Jamil msg 3084): Name und
	 * Beschreibung, darunter die Aufgaben (Titel, Beschreibung, Lautstärke/Schmutz) mit ↑/↓ und Entfernen.
	 * Feldnamen wie bisher (`todo_<i>`, `todo_beschreibung_<i>` …), damit `todosAusFormular` sie liest.
	 */
	type Aufgabe = { titel: string; beschreibung: string; lautstaerke: string; schmutz: string };
	let {
		aktion = '',
		name = '',
		beschreibung = '',
		aufgaben = [],
		knopf,
		abbrechen
	}: {
		aktion?: string;
		name?: string;
		beschreibung?: string | null;
		aufgaben?: Aufgabe[];
		knopf: string;
		/** Link oder Funktion für „Abbrechen“ */
		abbrechen: string | (() => void);
	} = $props();

	const leer = (): Aufgabe => ({ titel: '', beschreibung: '', lautstaerke: '', schmutz: '' });
	// Startwerte einmalig übernehmen; danach gehört die Liste dem Formular
	const start = () => (aufgaben.length ? aufgaben.map((a) => ({ ...a })) : [leer()]);
	let todos = $state<Aufgabe[]>(start());

	function verschieben(i: number, r: -1 | 1) {
		const z = i + r;
		if (z < 0 || z >= todos.length) return;
		[todos[i], todos[z]] = [todos[z], todos[i]];
	}
</script>

<form method="POST" action={aktion || undefined} use:enhance class="av-form">
	<Abschnitt titel="Vorlage">
		<div class="kd-formular">
			<label>Name *<input type="text" name="name" value={name} required maxlength="100" /></label>
			<label>Beschreibung<textarea name="beschreibung" rows="2" maxlength="500">{beschreibung ?? ''}</textarea></label>
		</div>
	</Abschnitt>

	<Abschnitt titel="Aufgaben" anzahl={todos.length}>
		<ol class="av-liste">
			{#each todos as todo, i (i)}
				<li class="av-aufgabe">
					<span class="av-nr" aria-hidden="true">{i + 1}</span>
					<div class="av-felder">
						<input type="text" name="todo_{i}" placeholder="Aufgabe {i + 1}" aria-label="Aufgabe {i + 1}" bind:value={todo.titel} required maxlength="200" />
						<input type="text" name="todo_beschreibung_{i}" placeholder="Beschreibung (optional)" aria-label="Beschreibung Aufgabe {i + 1}" bind:value={todo.beschreibung} maxlength="500" />
						<div class="av-stufen">
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
					<div class="av-knoepfe">
						<button type="button" class="knopf-ghost klein" aria-label="Aufgabe {i + 1} nach oben" onclick={() => verschieben(i, -1)} disabled={i === 0}>↑</button>
						<button type="button" class="knopf-ghost klein" aria-label="Aufgabe {i + 1} nach unten" onclick={() => verschieben(i, 1)} disabled={i === todos.length - 1}>↓</button>
						<button type="button" class="kd-knopf gefahr klein" aria-label="Aufgabe {i + 1} entfernen" onclick={() => (todos = todos.filter((_, j) => j !== i))}>×</button>
					</div>
				</li>
			{/each}
		</ol>
		<button type="button" class="kd-knopf hell" onclick={() => todos.push(leer())}>+ Aufgabe hinzufügen</button>
	</Abschnitt>

	<FormFuss>
		{#if typeof abbrechen === 'string'}
			<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
		{:else}
			<button type="button" class="kd-knopf hell" onclick={abbrechen}>Abbrechen</button>
		{/if}
		<button type="submit" class="kd-knopf">{knopf}</button>
	</FormFuss>
</form>

<style>
	.av-form {
		display: grid;
		gap: var(--ui-abstand-block, var(--ui-a4));
	}
	.av-liste {
		list-style: none;
		margin: 0 0 var(--ui-a3);
		padding: 0;
		display: grid;
		gap: var(--ui-a3);
	}
	.av-aufgabe {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--ui-a2) var(--ui-a3);
		align-items: start;
		padding: var(--ui-a3);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.av-nr {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-top: 0.4rem;
		border-radius: 999px;
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
		font-family: var(--ui-schrift-titel);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
	}
	.av-felder {
		display: grid;
		gap: var(--ui-a2);
		min-width: 0;
	}
	.av-stufen {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--ui-a2);
	}
	.av-knoepfe {
		display: flex;
		gap: 0.25rem;
	}
	@media (max-width: 640px) {
		.av-aufgabe {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.av-knoepfe {
			grid-column: 1 / -1;
			justify-content: flex-end;
		}
		.av-stufen {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
