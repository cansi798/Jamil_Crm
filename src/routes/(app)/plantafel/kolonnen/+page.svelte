<script lang="ts">
	import { enhance } from '$app/forms';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Kolonne = PageData['kolonnen'][number];
	const fehlerIn = (b: string) => (form && 'bereich' in form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>Kolonnen</title>
</svelte:head>

<main class="kd-seite">
	<a href="/plantafel" class="kd-zurueck">← Plantafel</a>
	<h1>Kolonnen</h1>
	<p class="kd-info">
		Eine Kolonne ist ein festes Team. Plant ihr eine Kolonne auf der Plantafel ein, bekommt jedes Mitglied den Termin – und sieht den
		Auftrag unter „Meine Aufträge“. Einzelne Tage lassen sich danach pro Person ändern.
	</p>

	<ul class="ko-liste" aria-label="Kolonnen">
		{#each data.kolonnen as ko (ko.id)}
			<li class:aus={!ko.aktiv}>
				<details open={!!fehlerIn(ko.id)}>
					<summary>
						<strong>{ko.name}</strong>
						<span class="kd-info">
							{ko.mitglieder.map((m) => m.name).join(', ') || 'keine Mitglieder'}{ko.leiterName ? ` · Führer: ${ko.leiterName}` : ''}{ko.fahrzeug ? ` · ${ko.fahrzeug}` : ''}{ko.aktiv ? '' : ' · aus'}
						</span>
					</summary>
					{@render formular(ko)}
					<form method="POST" action="?/loeschen" use:enhance class="ko-loeschen">
						<input type="hidden" name="id" value={ko.id} />
						<button type="submit" class="kd-knopf hell">Kolonne löschen</button>
					</form>
				</details>
			</li>
		{:else}
			<li class="kd-leer">Noch keine Kolonnen.</li>
		{/each}
	</ul>

	<AddPanel label="Kolonne hinzufügen" offen={!!fehlerIn('neu')}>
		{#snippet children(schliessen)}{@render formular(null, schliessen)}{/snippet}
	</AddPanel>
</main>

{#snippet formular(ko: Kolonne | null, schliessen?: () => void)}
	{@const b = ko?.id ?? 'neu'}
	<form method="POST" action="?/speichern" use:enhance={ohneReset} class="kd-formular ko-formular">
		{#if fehlerIn(b)}<p role="alert" class="kd-fehler">{fehlerIn(b)}</p>{/if}
		{#if ko}<input type="hidden" name="id" value={ko.id} />{/if}
		<div class="ko-raster">
			<label>Name <input type="text" name="name" maxlength="100" required value={ko?.name ?? ''} placeholder="z. B. Kolonne A" /></label>
			<label>
				Kolonnenführer (optional)
				<select name="leiterId">
					<option value="">–</option>
					{#each data.mitarbeiter as m (m.id)}<option value={m.id} selected={ko?.leiterId === m.id}>{m.name}</option>{/each}
				</select>
			</label>
			<label>Fahrzeug (optional) <input type="text" name="fahrzeug" maxlength="100" value={ko?.fahrzeug ?? ''} placeholder="z. B. HH-BW 123" /></label>
		</div>
		<fieldset>
			<legend>Mitglieder</legend>
			<div class="ko-mitglieder">
				{#each data.mitarbeiter as m (m.id)}
					<label class="kd-haken">
						<input type="checkbox" name="mitglieder" value={m.id} checked={!!ko?.mitglieder.some((x) => x.id === m.id)} />
						<span>{m.name}</span>
					</label>
				{/each}
			</div>
		</fieldset>
		{#if ko}
			<label class="kd-haken"><input type="checkbox" name="aktiv" value="true" checked={ko.aktiv} /><span>aktiv (auf der Plantafel)</span></label>
			<input type="hidden" name="aktiv" value="false" />
		{/if}
		<div class="ko-knoepfe">
			<button type="submit" class="kd-knopf">{ko ? 'Speichern' : 'Kolonne anlegen'}</button>
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
		</div>
	</form>
{/snippet}

<style>
	.ko-liste {
		list-style: none;
		margin: 1rem 0;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
	}
	.ko-liste > li + li {
		border-top: 1px solid var(--m365-rand);
	}
	.ko-liste summary {
		display: grid;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		cursor: pointer;
		list-style: none;
	}
	.ko-liste summary::-webkit-details-marker {
		display: none;
	}
	.ko-liste details[open] {
		padding-bottom: 0.75rem;
	}
	.ko-liste details[open] > form {
		padding: 0.5rem 0.75rem 0;
	}
	.ko-liste li.aus strong {
		color: var(--m365-text-leise);
	}
	.ko-raster {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	}
	.ko-mitglieder {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0 1rem;
	}
	.ko-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.ko-loeschen {
		padding: 0.5rem 0.75rem 0;
	}
</style>
