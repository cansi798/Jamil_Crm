<script lang="ts">
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
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
	const link = (o: { ansicht?: 'board' | 'liste'; nur?: string; status?: string } = {}) => {
		const ansicht = o.ansicht ?? data.ansicht;
		const nur = o.nur ?? data.nur;
		const status = o.status ?? data.filter.status;
		const p = new URLSearchParams();
		if (ansicht === 'liste') p.set('ansicht', 'liste');
		if (!data.personFilter && nur !== 'meine') p.set('nur', nur);
		if (data.personFilter && data.filter.person !== data.benutzerId) p.set('person', data.filter.person);
		if (status !== 'alle') p.set('status', status);
		// Ausdrücklich „keine Filter“ (≠ erster Besuch): Marker, damit keine Standard-Ansicht darüber springt
		if (p.toString() === '') p.set('alle', '1');
		return `/todos?${p}`;
	};
	// Status-Chips wie die Spalten des Boards (Jamil msg 2805)
	const STATUS_CHIPS = [
		['offen', 'Offen'],
		['in-arbeit', 'In Arbeit'],
		['erledigt', 'Erledigt'],
		['alle', 'Alle']
	] as const;
	let neuOffen = $state(untrack(() => !!form?.todoWerte || Object.values(data.vorbelegt ?? {}).some(Boolean)));
	const aktionen = { umschalten: '?/umschalten', aendern: '?/aendern', loeschen: '?/loeschen', serieBeenden: '?/serieBeenden' };
</script>

<svelte:head>
	<title>Aufgaben</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div><h1>{data.filter.person === data.benutzerId || (!data.personFilter && data.nur === 'meine') ? 'Meine Aufgaben' : 'Aufgaben'}</h1></div>
		{#if data.darfBearbeiten}
			<div class="seiten-aktionen">
				<button type="button" class="kd-knopf" aria-label="Aufgabe hinzufügen" aria-expanded={neuOffen} onclick={() => (neuOffen = !neuOffen)}>
					<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
					Aufgabe
				</button>
			</div>
		{/if}
	</header>

	<FilterLeiste ansichten="todos" label="Aufgaben filtern">
		{#snippet suche()}
			{#if data.ansicht === 'liste'}<input type="hidden" name="ansicht" value="liste" />{/if}
			{#if !data.personFilter && data.nur !== 'meine'}<input type="hidden" name="nur" value={data.nur} />{/if}
			{#if data.filter.status !== 'alle'}<input type="hidden" name="status" value={data.filter.status} />{/if}
		{/snippet}
		{#snippet filter()}
			<Umschalter label="Status" aktiv={data.filter.status} eintraege={STATUS_CHIPS.map(([wert, text]) => ({ wert, text, href: link({ status: wert }) }))} />
			{#if data.personFilter && data.mitarbeiter.length > 0}
				<PersonWahl
					name="person"
					label="Zugewiesen an"
					leerText="Alle Personen"
					klein
					personen={data.mitarbeiter.map((m) => ({ id: m.id, name: m.id === data.benutzerId ? `Ich (${m.name})` : m.name }))}
					wert={data.filter.person === 'alle' ? '' : data.filter.person}
					absenden
				/>
			{/if}
			<noscript><button type="submit" class="kd-knopf hell">Filtern</button></noscript>
		{/snippet}
		{#snippet rechts()}
			<Umschalter
				label="Ansicht"
				aktiv={data.ansicht}
				eintraege={[
					{ wert: 'board', text: 'Board', href: link({ ansicht: 'board' }) },
					{ wert: 'liste', text: 'Liste', href: link({ ansicht: 'liste' }) }
				]}
			/>
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
					standardZustaendig={data.benutzerId}
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
