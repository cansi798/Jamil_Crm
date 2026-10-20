<script lang="ts">
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import { enhance } from '$app/forms';
	import { euro } from '$lib/geld';
	import { GEWERKE, GEWERK_NAMEN } from '$lib/katalog-werte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const link = (gewerk: string | null) => {
		const p = new URLSearchParams();
		if (gewerk) p.set('gewerk', gewerk);
		if (data.suche) p.set('suche', data.suche);
		const q = p.toString();
		return q ? `/katalog?${q}` : '/katalog';
	};
	const uebernommen = $derived(form && 'uebernommen' in form ? form.uebernommen : null);
</script>

<svelte:head>
	<title>Leistungskatalog</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Leistungskatalog</h1>
			<p class="seiten-meta">{data.positionen.length} Positionen{data.gewerk ? ` · ${GEWERK_NAMEN[data.gewerk]}` : ''}</p>
		</div>
		{#if data.darfBearbeiten}
			<div class="seiten-aktionen">
				<a href={data.gewerk ? `/katalog/neu?gewerk=${data.gewerk}` : '/katalog/neu'} class="kd-knopf">+ Position</a>
			</div>
		{/if}
	</header>
	{#if data.stundensatz}
		<p class="kt-hinweis" role="note">
			Laut <a href="/kalkulation">Kalkulation</a>: Verrechnungssatz {euro(data.stundensatz.empfohlenCent)}/h
			(Kosten-Stundensatz {data.stundensatz.kostendeckendCent === null ? '–' : `${euro(data.stundensatz.kostendeckendCent)}/h`}) – mit der
			Arbeitszeit je Position wird daraus ein Lohn-Vorschlag.
		</p>
		{#if data.unterKosten.length > 0}
			<details class="kt-unter">
				<summary>{data.unterKosten.length} Position{data.unterKosten.length === 1 ? '' : 'en'} unter kostendeckend</summary>
				<ul>
					{#each data.unterKosten as p (p.id)}
						<li>
							<a href={`/katalog/${p.id}`}>{p.bezeichnung}</a>
							<span class="kd-info">Lohn {euro(p.lohnCent)} je {p.einheit} · kostendeckend ab {euro(p.mindestCent)}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
		{#if data.ohneArbeitszeit > 0}
			<p class="kd-info">{data.ohneArbeitszeit} aktive Positionen ohne Arbeitszeit – für sie gibt es noch keine Prüfung.</p>
		{/if}
	{/if}

	<nav aria-label="Gewerk">
		<ul class="af-reiter">
			<li><a href={link(null)} aria-current={data.gewerk === null ? 'page' : undefined}>Alle</a></li>
			{#each GEWERKE as g (g)}
				<li><a href={link(g)} aria-current={data.gewerk === g ? 'page' : undefined}>{GEWERK_NAMEN[g]}</a></li>
			{/each}
		</ul>
	</nav>

	<FilterLeiste label="Katalog filtern">
		{#snippet suche()}
			{#if data.gewerk}<input type="hidden" name="gewerk" value={data.gewerk} />{/if}
			<SuchFeld wert={data.suche} label="Katalog durchsuchen" placeholder="Nummer oder Bezeichnung" />
		{/snippet}
	</FilterLeiste>

	{#if uebernommen}
		<p role="status" class="kt-hinweis ok">
			{GEWERK_NAMEN[uebernommen.gewerk]}: {uebernommen.neu === 1 ? '1 neue Position' : `${uebernommen.neu} neue Positionen`} übernommen.
			{#if uebernommen.neu > 0 && data.mitPreisen}Bitte die Preise eintragen.{/if}
		</p>
	{:else if form && 'fehler' in form}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	<ul class="kd-liste">
		{#each data.positionen as p (p.id)}
			<li>
				<a href={`/katalog/${p.id}`} class:kt-inaktiv={!p.aktiv}>
					<span class="af-kopfzeile">
						<strong>{p.nummer ? `${p.nummer} · ` : ''}{p.bezeichnung}</strong>
						{#if data.mitPreisen}
							{#if p.einzelpreisCent === 0}
								<span class="kt-preis-fehlt">Preis fehlt</span>
							{:else}
								<span class="kt-preis">{euro(p.einzelpreisCent ?? 0)} / {p.einheit}</span>
							{/if}
						{/if}
					</span>
					<span class="kd-info">
						{p.einheit}{p.gewerk ? ` · ${GEWERK_NAMEN[p.gewerk]}` : ''}{p.aktiv ? '' : ' · nicht aktiv'}
					</span>
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				{data.suche || data.gewerk ? 'Keine Positionen gefunden.' : 'Noch keine Positionen. Übernehmen Sie eine Startvorlage oder legen Sie eigene Positionen an.'}
			</li>
		{/each}
	</ul>
	{#if data.positionen.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Positionen angezeigt. Bitte die Suche eingrenzen.</p>
	{/if}

	{#if data.darfBearbeiten}
		<AddPanel label="Startvorlage übernehmen" offen={data.positionen.length === 0 && !data.suche && !data.gewerk}>
			{#snippet children()}
		<p class="kd-info">Typische Positionen je Gewerk, ohne Preise. Bereits übernommene werden nicht doppelt angelegt.</p>
		<div class="kt-vorlagen">
			{#each data.vorlagen as v (v.gewerk)}
				<form method="POST" action="?/vorlage" use:enhance>
					<input type="hidden" name="gewerk" value={v.gewerk} />
					<button type="submit" class="kd-knopf hell" disabled={v.offen === 0}>
						{v.name}
						<span class="kt-klein">{v.offen === 0 ? 'alle übernommen' : `${v.offen} von ${v.anzahl} neu`}</span>
					</button>
				</form>
			{/each}
		</div>
			{/snippet}
		</AddPanel>
	{/if}
</main>
