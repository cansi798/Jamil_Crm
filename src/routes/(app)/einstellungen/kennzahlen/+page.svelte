<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import DatumWahl from '$lib/components/ui/DatumWahl.svelte';
	import type { ActionData, PageData } from './$types';

	/**
	 * Kennzahlen einstellen (Jamil msg 2946): je Kennzahl an/aus und „Erfassen ab“. Aus = nirgends gezeigt (Cockpit,
	 * Kacheln, Start) und nicht gerechnet; „ab“ = Daten davor zählen für diese Kennzahl nicht (Hinweis „erfasst seit …“).
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const BEREICHE = ['Cockpit', 'Kunden', 'Aufträge', 'Angebote', 'Auftragsbestätigungen'] as const;
	const TITEL: Record<(typeof BEREICHE)[number], string> = {
		Cockpit: 'Cockpit (Auswertungen → Kennzahlen, Start)',
		Kunden: 'Kacheln auf „Kunden“',
		Aufträge: 'Kacheln auf „Aufträge“',
		Angebote: 'Kacheln auf „Ausgangsbelege → Angebote“',
		Auftragsbestätigungen: 'Kacheln auf „Ausgangsbelege → Auftragsbestätigungen“'
	};
	const heute = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
</script>

<svelte:head><title>Kennzahlen einstellen</title></svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Kennzahlen einstellen</h1>
			<p class="seiten-meta">
				<span class="meta-text">Je Kennzahl: <strong>an/aus</strong> (aus = nirgends gezeigt und nicht gerechnet) und <strong>„Erfassen ab“</strong> – Daten
				davor zählen für diese Kennzahl nicht, z. B. weil sie erst seit dem Start des CRM vollständig sind.</span>
			<InfoFenster id="kennzahlen.seite" /></p>
		</div>
	</header>

	<form method="POST" use:enhance={() => async ({ update }) => update({ reset: false })} class="kz-form">
		{#if form?.fehler}<p class="kd-fehler" role="alert">{form.fehler}</p>{/if}
		{#if form?.ok}<p class="kd-info" role="status">{form.ok}</p>{/if}
		{#each BEREICHE as b (b)}
			<section class="kz-gruppe" aria-labelledby={`kz-${b}`}>
				<h2 id={`kz-${b}`}>{TITEL[b]}</h2>
				<table class="kz-tabelle">
					<thead><tr><th scope="col">Kennzahl</th><th scope="col">An</th><th scope="col">Erfassen ab</th></tr></thead>
					<tbody>
						{#each data.zeilen.filter((z) => z.bereich === b) as z (z.id)}
							<tr data-kennzahl={z.id}>
								<td><strong>{z.titel}</strong><span class="kd-info">{z.erklaerung}</span></td>
								<td><Schalter name={`aktiv_${z.id}`} label={z.aktiv ? 'an' : 'aus'} an={z.aktiv} /></td>
								<td class="kz-ab">
									<DatumWahl name={`ab_${z.id}`} wert={z.ab ?? ''} label="ab Beginn" />
									{#if z.ab}<span class="kd-info">erfasst seit {z.ab.split('-').reverse().join('.')}</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
		<p class="kd-info">„Erfassen ab“ darf nicht nach heute ({heute.split('-').reverse().join('.')}) liegen. Leer = alle Daten.</p>
		<div class="kz-fuss"><button type="submit" class="kd-knopf">Speichern</button></div>
	</form>
</main>

<style>
	.kz-form {
		display: grid;
		gap: 1rem;
	}
	.kz-gruppe h2 {
		margin: 0 0 0.5rem;
		font-size: var(--ui-schrift-l);
	}
	.kz-tabelle {
		width: 100%;
		border-collapse: collapse;
		background: var(--ui-flaeche);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
	}
	.kz-tabelle th,
	.kz-tabelle td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		vertical-align: middle;
		border-bottom: 1px solid var(--ui-rand);
	}
	.kz-tabelle th {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.kz-tabelle td:first-child span {
		display: block;
	}
	.kz-ab {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
	}
	.kz-fuss {
		position: sticky;
		bottom: 0;
		padding: 0.75rem 0;
		background: var(--ui-hintergrund);
	}
	/* schmal: Zeilen als Karten */
	@media (max-width: 40rem) {
		.kz-tabelle thead {
			display: none;
		}
		.kz-tabelle tr {
			display: grid;
			grid-template-columns: 1fr auto;
			border-bottom: 1px solid var(--ui-rand);
		}
		.kz-tabelle td {
			border: none;
		}
		.kz-tabelle td:first-child {
			grid-column: 1 / -1;
			padding-bottom: 0;
		}
	}
</style>
