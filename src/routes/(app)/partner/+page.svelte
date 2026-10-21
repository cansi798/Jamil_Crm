<script lang="ts">
	import '$lib/stil/kunden.css';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import { PARTNER_ART_NAMEN, PARTNER_ARTEN } from '$lib/partner';
	import type { PageData } from './$types';

	/** Partner-Liste (Jamil msgs 2854/2856): Auftraggeber, Subunternehmer, Lieferanten; Warnung bei Nachweisen. */
	let { data }: { data: PageData } = $props();
	const link = (art: string | null) => {
		const p = new URLSearchParams();
		if (art) p.set('art', art);
		if (data.suche) p.set('suche', data.suche);
		if (data.inaktive) p.set('inaktive', 'ja');
		const q = p.toString();
		return q ? `?${q}` : '/partner';
	};
</script>

<svelte:head><title>Partner</title></svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Partner</h1>
			<p class="seiten-meta">Auftraggeber (Baumärkte, Plattformen), Subunternehmer und Lieferanten – mit Konditionen und Nachweisen.</p>
		</div>
		<div class="seiten-aktionen"><a href="/partner/neu" class="kd-knopf">+ Partner</a></div>
	</header>

	<FilterLeiste label="Partner filtern">
		{#snippet suche()}
			<SuchFeld wert={data.suche} label="Partner suchen" placeholder="Name, Ort oder Nummer" />
			{#if data.art}<input type="hidden" name="art" value={data.art} />{/if}
		{/snippet}
		{#snippet filter()}
			<Umschalter label="Art" aktiv={data.art ?? 'alle'} eintraege={[{ wert: 'alle', text: 'Alle', href: link(null) }, ...PARTNER_ARTEN.map((a) => ({ wert: a, text: PARTNER_ART_NAMEN[a], href: link(a) }))]} />
		{/snippet}
		{#snippet rechts()}
			<span class="kd-info">{data.partner.length} Partner</span>
		{/snippet}
	</FilterLeiste>

	<ul class="kd-liste">
		{#each data.partner as p (p.id)}
			<li>
				<a href={`/partner/${p.id}`}>
					<strong>{p.name}{p.aktiv ? '' : ' (inaktiv)'}</strong>
					<span class="kd-info">{PARTNER_ART_NAMEN[p.art]}{p.ort ? ` · ${p.ort}` : ''}{p.auftraege ? ` · ${p.auftraege} Aufträge` : ''}</span>
					{#if p.warnung}<span class="pa-warnung">⚠ Nachweis {p.warnung}</span>{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				<span>{data.suche || data.art ? 'Keine Partner gefunden.' : 'Noch keine Partner angelegt.'}</span>
				<a href="/partner/neu" class="kd-knopf hell">+ Partner anlegen</a>
			</li>
		{/each}
	</ul>
	<p class="kd-info"><a href={data.inaktive ? '/partner' : '?inaktive=ja'}>{data.inaktive ? 'Inaktive ausblenden' : 'Inaktive zeigen'}</a></p>
</main>

<style>
	.pa-warnung {
		display: block;
		color: var(--ui-gefahr);
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
</style>
