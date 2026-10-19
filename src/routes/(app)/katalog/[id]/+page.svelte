<script lang="ts">
	import { enhance } from '$app/forms';
	import KatalogFormular from '$lib/components/KatalogFormular.svelte';
	import { centAlsEingabe, euro } from '$lib/geld';
	import { GEWERK_NAMEN } from '$lib/katalog-werte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const p = $derived(data.position);
	const werte = $derived(
		(form && 'werte' in form ? (form.werte as Record<string, string>) : null) ?? {
			bezeichnung: p.bezeichnung,
			einheit: p.einheit,
			gewerk: p.gewerk ?? '',
			nummer: p.nummer ?? '',
			beschreibung: p.beschreibung ?? '',
			lohn: p.lohnCent === undefined ? '' : centAlsEingabe(p.lohnCent),
			material: p.materialCent === undefined ? '' : centAlsEingabe(p.materialCent),
			aktiv: p.aktiv ? 'true' : 'false'
		}
	);
</script>

<svelte:head>
	<title>{p.bezeichnung}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/katalog" class="kd-zurueck">← Katalog</a>
	<h1>{p.bezeichnung}</h1>
	<p class="kd-info">
		{p.einheit}{p.gewerk ? ` · ${GEWERK_NAMEN[p.gewerk]}` : ''}{p.aktiv ? '' : ' · nicht aktiv'}
		{#if data.mitPreisen}
			· {p.einzelpreisCent === 0 ? 'Preis fehlt' : `${euro(p.einzelpreisCent ?? 0)} je ${p.einheit}`}
		{/if}
	</p>
	{#if data.darfBearbeiten}
		<KatalogFormular
			aktion="?/speichern"
			{werte}
			fehler={form && 'fehler' in form && 'werte' in form ? (form.fehler as string) : null}
			mitPreisen={data.mitPreisen}
			mitAktiv
			knopf="Speichern"
			abbrechen="/katalog"
		/>
		<h2>Position entfernen</h2>
		<p class="kd-info">Ist die Position schon in einem Angebot verwendet, wird sie nur deaktiviert.</p>
		{#if form && 'fehler' in form && !('werte' in form)}
			<p role="alert" class="kd-fehler">{form.fehler}</p>
		{/if}
		<form method="POST" action="?/loeschen" use:enhance>
			<button type="submit" class="kd-knopf gefahr">Entfernen</button>
		</form>
	{:else if p.beschreibung}
		<p>{p.beschreibung}</p>
	{/if}
</main>
