<script lang="ts">
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const NAMEN = { meine: 'Meine', offen: 'Offen', alle: 'Alle' } as const;
	const LEER = {
		meine: 'Ihnen sind keine To-dos zugewiesen.',
		offen: 'Keine offenen To-dos.',
		alle: 'Noch keine To-dos angelegt.'
	} as const;
</script>

<svelte:head>
	<title>To-dos</title>
</svelte:head>

<main class="kd-seite">
	<h1>To-dos</h1>

	{#if data.reiter.length > 1}
		<nav aria-label="Auswahl">
			<ul class="af-reiter">
				{#each data.reiter as r (r)}
					<li>
						<a href={r === 'meine' ? '/todos' : `/todos?nur=${r}`} aria-current={data.nur === r ? 'page' : undefined}>
							{NAMEN[r]}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	{#if form?.fehler && !form?.todoWerte}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	{#if data.darfBearbeiten}
		<TodoNeu
			aktion="?/anlegen"
			mitarbeiter={data.mitarbeiter}
			fehler={form?.todoWerte ? form.fehler : null}
			werte={form?.todoWerte ?? data.vorbelegt}
		/>
	{/if}

	<TodoListe
		todos={data.todos}
		heute={data.heute}
		benutzerId={data.benutzerId}
		darfBearbeiten={data.darfBearbeiten}
		mitarbeiter={data.mitarbeiter}
		aktionen={{ umschalten: '?/umschalten', aendern: '?/aendern', loeschen: '?/loeschen' }}
		leer={LEER[data.nur]}
	/>
</main>
