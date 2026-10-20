<script lang="ts">
	import { untrack } from 'svelte';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import TodoKanban from '$lib/components/TodoKanban.svelte';
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const NAMEN = { meine: 'Meine', offen: 'Offen', alle: 'Alle' } as const;
	const LEER = {
		meine: 'Keine Aufgaben – weder direkt zugewiesen noch in Aufträgen, für die Sie zuständig sind.',
		offen: 'Keine offenen Aufgaben.',
		alle: 'Noch keine Aufgaben angelegt.'
	} as const;

	/** Link mit Ansicht, Reiter und Filtern (leere Werte entfallen) – wie auf der Auftragsseite. */
	const link = (o: { ansicht?: 'board' | 'liste'; nur?: string } = {}) => {
		const ansicht = o.ansicht ?? data.ansicht;
		const nur = o.nur ?? data.nur;
		const p = new URLSearchParams();
		if (ansicht === 'liste') p.set('ansicht', 'liste');
		if (nur !== 'meine') p.set('nur', nur);
		if (data.filter.person) p.set('person', data.filter.person);
		if (data.filter.status) p.set('status', data.filter.status);
		const q = p.toString();
		return q ? `/todos?${q}` : '/todos';
	};
	let neuOffen = $state(untrack(() => !!form?.todoWerte || Object.values(data.vorbelegt ?? {}).some(Boolean)));
	const aktionen = { umschalten: '?/umschalten', aendern: '?/aendern', loeschen: '?/loeschen', serieBeenden: '?/serieBeenden' };
</script>

<svelte:head>
	<title>Aufgaben</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<h1>{data.nur === 'meine' ? 'Meine Aufgaben' : 'Aufgaben'}</h1>
		<div class="seiten-aktionen">
			<nav class="af-ansicht" aria-label="Ansicht">
				<a href={link({ ansicht: 'board' })} aria-current={data.ansicht === 'board' ? 'page' : undefined}>Board</a>
				<a href={link({ ansicht: 'liste' })} aria-current={data.ansicht === 'liste' ? 'page' : undefined}>Liste</a>
			</nav>
			{#if data.darfBearbeiten}
				<button type="button" class="kd-knopf" aria-expanded={neuOffen} onclick={() => (neuOffen = !neuOffen)}>
					<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
					Aufgabe hinzufügen
				</button>
			{/if}
		</div>
	</header>

	<FilterLeiste label="Aufgaben filtern">
		{#snippet suche()}
			{#if data.ansicht === 'liste'}<input type="hidden" name="ansicht" value="liste" />{/if}
			{#if data.nur !== 'meine'}<input type="hidden" name="nur" value={data.nur} />{/if}
		{/snippet}
		{#snippet filter()}
			{#if data.reiter.length > 1}
				<nav aria-label="Meine oder alle Aufgaben" class="pills">
					{#each data.reiter as r (r)}
						<a href={link({ nur: r })} class="pill" class:aktiv={data.nur === r} aria-current={data.nur === r ? 'page' : undefined}>{NAMEN[r]}</a>
					{/each}
				</nav>
			{/if}
			{#if data.mitarbeiter.length > 0}
				<PersonWahl name="person" label="Zugewiesen an" leerText="Alle Personen" klein personen={data.mitarbeiter} wert={data.filter.person ?? ''} absenden />
			{/if}
			<div class="td-status">
				<Auswahl name="status" klein aria-label="Status" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
					<option value="" selected={data.filter.status === ''}>Alle Status</option>
					<option value="offen" selected={data.filter.status === 'offen'}>offen</option>
					<option value="erledigt" selected={data.filter.status === 'erledigt'}>erledigt</option>
				</Auswahl>
			</div>
			<noscript><button type="submit" class="kd-knopf hell">Filtern</button></noscript>
		{/snippet}
	</FilterLeiste>

	{#if form?.fehler && !form?.todoWerte}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	{#if data.darfBearbeiten}
		<AddPanel label="Aufgabe hinzufügen" knopf={false} bind:offen={neuOffen}>
			{#snippet children(schliessen)}
				<TodoNeu
					aktion="?/anlegen"
					mitarbeiter={data.mitarbeiter}
					fehler={form?.todoWerte ? form.fehler : null}
					werte={form?.todoWerte ?? data.vorbelegt}
					onfertig={schliessen}
					onabbrechen={schliessen}
				/>
			{/snippet}
		</AddPanel>
	{/if}

	{#if data.ansicht === 'liste'}
		<TodoListe
			todos={data.todos}
			heute={data.heute}
			benutzerId={data.benutzerId}
			darfBearbeiten={data.darfBearbeiten}
			mitarbeiter={data.mitarbeiter}
			{aktionen}
			leer={LEER[data.nur]}
		/>
	{:else}
		<TodoKanban
			zeigeQuelle={data.nur === 'meine'}
			todos={data.todos}
			heute={data.heute}
			benutzerId={data.benutzerId}
			darfBearbeiten={data.darfBearbeiten}
			mitarbeiter={data.mitarbeiter}
			{aktionen}
			leer={LEER[data.nur]}
		/>
	{/if}
</main>

<style>
	.td-status {
		min-width: 10rem;
	}
	.td-filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 0.5rem 0 1rem;
	}
	.td-filter label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.875rem;
		min-width: 12rem;
	}
	.td-filter select {
		min-height: var(--tippziel, 44px);
	}
</style>
