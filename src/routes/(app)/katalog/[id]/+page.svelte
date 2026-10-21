<script lang="ts">
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
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
			arbeitMinuten: p.arbeitMinuten === null ? '' : String(p.arbeitMinuten).replace('.', ','),
			aktiv: p.aktiv ? 'true' : 'false'
		}
	);
	/** Jamil msg 3043: „Position löschen“ oben rechts, Rückfrage unter dem Kopf. */
	let loeschenOffen = $state(false);
	const loeschFehler = $derived(form && 'loeschFehler' in form && form.loeschFehler ? ((form as { fehler?: string }).fehler ?? null) : null);
</script>

<svelte:head>
	<title>{p.bezeichnung}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/katalog" class="kd-zurueck">← Katalog</a>
	<header class="seiten-kopf">
		<div>
			<h1>{p.bezeichnung}</h1>
			<p class="seiten-meta">
				{p.einheit}{p.gewerk ? ` · ${GEWERK_NAMEN[p.gewerk]}` : ''}{p.aktiv ? '' : ' · nicht aktiv'}
				{#if data.mitPreisen}
					· {p.einzelpreisCent === 0 ? 'Preis fehlt' : `${euro(p.einzelpreisCent ?? 0)} je ${p.einheit}`}
				{/if}
			</p>
		</div>
		{#if data.darfBearbeiten}
			<div class="seiten-aktionen">
				<LoeschenKnopf ding="Position" bind:offen={loeschenOffen} />
			</div>
		{/if}
	</header>
	{#if data.darfBearbeiten}
		<LoeschenPanel ding="Position" bind:offen={loeschenOffen} fehler={loeschFehler}>
			Die Position wird endgültig gelöscht. Ist sie schon in einem Angebot verwendet, wird sie nur deaktiviert.
		</LoeschenPanel>
	{/if}
	{#if data.darfBearbeiten}
		<KatalogFormular
			aktion="?/speichern"
			{werte}
			fehler={form && 'fehler' in form && 'werte' in form ? (form.fehler as string) : null}
			mitPreisen={data.mitPreisen}
			mitAktiv
			satz={data.satz}
			knopf="Speichern"
			abbrechen="/katalog"
		/>
	{:else if p.beschreibung}
		<p>{p.beschreibung}</p>
	{/if}
</main>
