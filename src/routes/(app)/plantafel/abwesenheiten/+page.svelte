<script lang="ts">
	import { untrack } from 'svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import { tagDeutsch } from '$lib/zeit';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let neuOffen = $state(untrack(() => !!form?.fehler));

	const NAMEN = { urlaub: 'Urlaub', krank: 'Krank', sonstiges: 'Sonstiges' } as const;
	const werte = $derived((form && 'werte' in form ? form.werte : null) ?? ({} as Record<string, string>));
</script>

<svelte:head>
	<title>Abwesenheiten</title>
</svelte:head>

<main class="kd-seite">
	<a href="/plantafel" class="kd-zurueck">← Plantafel</a>
	<header class="seiten-kopf">
		<div>
			<h1>Abwesenheiten</h1>
			<p class="seiten-meta">Urlaub, Krankheit und Sonstiges – ganztägig, „von“ und „bis“ zählen mit.</p>
		</div>
		<div class="seiten-aktionen">
			<button type="button" class="kd-knopf" aria-expanded={neuOffen} onclick={() => (neuOffen = !neuOffen)}>
				<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
				Abwesenheit eintragen
			</button>
		</div>
	</header>

	{#if form && 'angelegt' in form}<p role="status" class="kd-info">Abwesenheit eingetragen.</p>{/if}
	<AddPanel label="Abwesenheit eintragen" knopf={false} bind:offen={neuOffen}>
		{#snippet children(schliessen)}
	<form method="POST" action="?/anlegen" use:enhance class="kd-formular">
		{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
		<div class="ab-feld">
			<span class="ab-label" aria-hidden="true">Mitarbeiter *</span>
			<PersonWahl name="benutzerId" label="Mitarbeiter" leerText="Mitarbeiter wählen" personen={data.mitarbeiter} wert={werte.benutzerId ?? ''} required />
		</div>
		<label>
			Art *
			<Auswahl name="art" required>
				{#each Object.entries(NAMEN) as [wert, name] (wert)}
					<option value={wert} selected={wert === (werte.art || 'urlaub')}>{name}</option>
				{/each}
			</Auswahl>
		</label>
		<div class="kd-zwei">
			<label>Von * <input type="date" name="von" required value={werte.von ?? data.heute} /></label>
			<label>Bis * <input type="date" name="bis" required value={werte.bis ?? data.heute} /></label>
		</div>
		<label>Notiz <input type="text" name="notiz" maxlength="200" value={werte.notiz ?? ''} /></label>
		<div class="knopf-reihe">
			<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
			<button type="submit" class="kd-knopf">Eintragen</button>
		</div>
	</form>
		{/snippet}
	</AddPanel>

	<Abschnitt titel="Eingetragen" anzahl={data.abwesenheiten.length}>
	<ul class="kd-liste">
		{#each data.abwesenheiten as a (a.id)}
			<li class="ab-eintrag" class:vorbei={a.bis < data.heute}>
				<span>
					<strong>{a.benutzerName}</strong> · {NAMEN[a.art]}<br />
					<span class="kd-info">
						{a.von === a.bis ? tagDeutsch(a.von) : `${tagDeutsch(a.von)} – ${tagDeutsch(a.bis)}`}{a.notiz ? ` · ${a.notiz}` : ''}
					</span>
				</span>
				<form method="POST" action="?/loeschen" use:enhance>
					<input type="hidden" name="id" value={a.id} />
					<button type="submit" class="kd-knopf gefahr klein" aria-label={`Abwesenheit von ${a.benutzerName} löschen`}>Löschen</button>
				</form>
			</li>
		{:else}
			<li class="kd-leer">Keine Abwesenheiten eingetragen.</li>
		{/each}
	</ul>
	</Abschnitt>
</main>

<style>
	.ab-eintrag {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--ui-rand);
	}
	.ab-eintrag:last-child {
		border-bottom: 0;
	}
	.ab-feld {
		display: grid;
		gap: 0.3rem;
		justify-items: start;
	}
	.ab-label {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.ab-eintrag.vorbei {
		opacity: 0.7;
	}
</style>
