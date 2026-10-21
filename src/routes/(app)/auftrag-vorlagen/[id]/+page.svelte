<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import AuftragVorlageFormular from '$lib/components/vorlagen/AuftragVorlageFormular.svelte';
	import { stufeName } from '$lib/stufen';
	import type { ActionData, PageData } from './$types';

	/**
	 * Eine Auftrags-Vorlage – Detailseite wie bei allen Vorlagen (Jamil msg 3084): Kopf mit Zurück, Überzeile, Name;
	 * „Bearbeiten“ und „Vorlage löschen“ oben rechts (msg 3043), Rückfrage darunter (msg 3091).
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Ø-Zeiten (msg 2858): Tage mit einer Nachkommastelle
	const tageText = (t: number | null) => (t === null ? '–' : `${t.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${t === 1 ? 'Tag' : 'Tage'}`);
	let bearbeiten = $state(false);
	// Nach dem Speichern (Weiterleitung auf dieselbe Seite) wieder die Ansicht zeigen
	afterNavigate(() => (bearbeiten = false));
	let loeschenOffen = $state(false);
	const loeschFehler = $derived(form && 'loeschFehler' in form && form.loeschFehler ? (form.fehler ?? null) : null);
	const aufgaben = $derived(
		data.vorlage.todos.map((t) => ({ titel: t.titel, beschreibung: t.beschreibung ?? '', lautstaerke: t.lautstaerke ? String(t.lautstaerke) : '', schmutz: t.schmutz ? String(t.schmutz) : '' }))
	);
	const anzahl = $derived(data.vorlage.todos.length === 1 ? '1 Aufgabe' : `${data.vorlage.todos.length} Aufgaben`);
</script>

<svelte:head>
	<title>{data.vorlage.name} – Auftrags-Vorlage</title>
</svelte:head>

<main class="kd-seite breit">
	<SeitenKopf ueberzeile="Auftrags-Vorlage" titel={data.vorlage.name} meta={anzahl} zurueck={{ href: '/auftrag-vorlagen', text: 'Auftrags-Vorlagen' }}>
		{#snippet aktionen()}
			{#if data.darfBearbeiten && !bearbeiten}
				<button type="button" class="kd-knopf hell" onclick={() => (bearbeiten = true)}>Bearbeiten</button>
				<LoeschenKnopf ding="Vorlage" bind:offen={loeschenOffen} />
			{/if}
		{/snippet}
	</SeitenKopf>
	{#if data.darfBearbeiten}
		<LoeschenPanel ding="Vorlage" bind:offen={loeschenOffen} fehler={loeschFehler}>
			Die Vorlage „{data.vorlage.name}“ wird endgültig gelöscht. Bestehende Aufträge bleiben erhalten.
		</LoeschenPanel>
	{/if}

	{#if form?.fehler && !loeschFehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	{#if bearbeiten}
		{#key data.vorlage}
			<AuftragVorlageFormular
				aktion="?/bearbeiten"
				name={data.vorlage.name}
				beschreibung={data.vorlage.beschreibung}
				{aufgaben}
				knopf="Speichern"
				abbrechen={() => (bearbeiten = false)}
			/>
		{/key}
	{:else}
		{#if data.vorlage.beschreibung}<p class="ui-lesetext av-beschreibung">{data.vorlage.beschreibung}</p>{/if}
		<Abschnitt titel="Aufgaben" anzahl={data.vorlage.todos.length}>
			{#if data.vorlage.todos.length === 0}
				<p class="kd-leer">Keine Aufgaben vorhanden.</p>
			{:else}
				<ol class="av-ansicht">
					{#each data.vorlage.todos as todo, i (todo.id)}
						<li>
							<span class="av-nr" aria-hidden="true">{i + 1}</span>
							<div>
								<strong>{todo.titel}</strong>
								{#if todo.beschreibung}<p class="kd-info">{todo.beschreibung}</p>{/if}
								{#if todo.lautstaerke || todo.schmutz}
									<p class="kd-info">
										{[todo.lautstaerke ? `Lautstärke: ${stufeName(todo.lautstaerke)}` : null, todo.schmutz ? `Schmutz: ${stufeName(todo.schmutz)}` : null].filter(Boolean).join(' · ')}
									</p>
								{/if}
								{#if data.zeiten}
									{@const z = data.zeiten[todo.titel.toLowerCase()]}
									<p class="av-zeit" data-testid="vorlage-zeit">
										{#if z && z.erledigt > 0}
											⏱ Ø {tageText(z.durchlaufTage)} bis erledigt · davon Ø {tageText(z.warteTage)} bis „In Arbeit“, Ø {tageText(z.bearbeitungTage)} in Arbeit
											<span class="kd-info">({z.erledigt} von {z.anzahl} erledigt)</span>
										{:else}
											<span class="kd-info">⏱ Noch keine Messung{z ? ` (${z.anzahl} angelegt, noch keine erledigt)` : ' – entsteht, sobald Aufträge mit dieser Vorlage angelegt und Aufgaben erledigt sind'}</span>
										{/if}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</Abschnitt>
	{/if}
</main>

<style>
	.av-beschreibung {
		margin: 0 0 var(--ui-a3);
		color: var(--ui-text-leise);
	}
	.av-ansicht {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
	}
	.av-ansicht li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--ui-a3);
		padding: 0.7rem var(--ui-a3);
	}
	.av-ansicht li + li {
		border-top: 1px solid var(--ui-rand);
	}
	.av-ansicht p {
		margin: 0.2rem 0 0;
	}
	.av-nr {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
		font-family: var(--ui-schrift-titel);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
	}
	.av-zeit {
		font-size: var(--ui-schrift-s);
	}
</style>
