<script lang="ts">
	import KennzahlKacheln, { type Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import { mitEinstellungen } from '$lib/kennzahlen';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import type { PageData } from './$types';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	let { data }: { data: PageData } = $props();

	// Kennzahl-Kacheln (msg 2799): Zeitraum und Gruppe stehen in der Adresse, Suche bleibt erhalten
	const kLink = (o: { zeitraum?: string; gruppe?: string | null }) => {
		const p = new URLSearchParams();
		if (data.suche) p.set('suche', data.suche);
		const z = o.zeitraum ?? data.zeitraum;
		if (z !== 'monat') p.set('zeitraum', z);
		const g = o.gruppe === undefined ? data.gruppe : o.gruppe;
		if (g) p.set('gruppe', g);
		const q = p.toString();
		return q ? `/kunden?${q}` : '/kunden';
	};
	const kacheln = $derived.by((): Kachel[] => {
		const kz = data.kennzahlen;
		if (!kz) return [];
		const umschalten = (id: string) => kLink({ gruppe: data.gruppe === id ? null : id });
		const l: Kachel[] = [{ id: 'aktiv', titel: 'Aktive Kunden', wert: String(kz.kundenAktiv), info: 'mit offenem Auftrag', href: umschalten('aktiv'), ton: 'blau' }];
		if (kz.kundenMitAngenommen !== null) {
			l.push({ id: 'angenommen', titel: 'Angebot angenommen', wert: String(kz.kundenMitAngenommen), info: 'Kunden im Zeitraum', href: umschalten('angenommen'), ton: 'gruen' });
			l.push({ id: 'abgelehnt', titel: 'Angebot abgelehnt', wert: String(kz.kundenMitAbgelehnt ?? 0), info: 'Kunden im Zeitraum', href: umschalten('abgelehnt'), ton: 'rot' });
			l.push({ id: 'abgelaufen', titel: 'Angebot abgelaufen', wert: String(kz.kundenMitAbgelaufen ?? 0), info: 'ohne Antwort', href: umschalten('abgelaufen'), ton: 'orange' });
		}
		// Einstellungen je Kennzahl (Jamil msg 2946): aus → weg, „Erfassen ab“ → Hinweis
		return mitEinstellungen(l, kz, (id) => `kunden_${id}`);
	});
	const zeile = (k: PageData['kunden'][number]) =>
		[k.art === 'firma' ? [k.vorname, k.nachname].filter(Boolean).join(' ') : '', k.ort, k.telefon]
			.filter(Boolean)
			.join(' · ');
</script>

<svelte:head>
	<title>Kunden</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<h1>Kunden</h1>
		{#if data.darfBearbeiten}
			<div class="seiten-aktionen"><a href="/kunden/neu" class="kd-knopf">+ Kunde</a></div>
		{/if}
	</header>

	<FilterLeiste ansichten="kunden" label="Kunden filtern">
		{#snippet suche()}
			<SuchFeld wert={data.suche} label="Kunden suchen" placeholder="Name, Firma, Ort, Telefon oder E-Mail" />
		{/snippet}
		{#snippet rechts()}
			<span class="kd-info">{data.kunden.length} {data.kunden.length === 1 ? 'Kunde' : 'Kunden'}</span>
		{/snippet}
	</FilterLeiste>

	{#if kacheln.length > 0}
		<KennzahlKacheln label="Kunden" {kacheln} zeitraum={data.zeitraum} zeitraumLink={(a) => kLink({ zeitraum: a })} aktiv={data.gruppe} />
		{#if data.gruppe}<p class="kd-info">Gefiltert nach Kachel – <a href={kLink({ gruppe: null })}>Filter aufheben</a></p>{/if}
	{/if}

	<ul class="kd-liste">
		{#each data.kunden as kunde (kunde.id)}
			<li>
				<a href={`/kunden/${kunde.id}`} class="zeile-mit-avatar">
					<Avatar name={kunde.name} groesse={34} />
					<strong>{kunde.name}</strong>
					{#if zeile(kunde)}<span class="kd-info">{zeile(kunde)}</span>{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				<span>{data.suche ? 'Keine Kunden gefunden. Anders schreiben oder nur einen Teil des Namens suchen.' : 'Noch keine Kunden angelegt.'}</span>
				{#if data.darfBearbeiten}<a href="/kunden/neu" class="kd-knopf hell">+ Kunde anlegen</a>{/if}
			</li>
		{/each}
	</ul>

	{#if data.kunden.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Kunden angezeigt. Bitte die Suche eingrenzen.</p>
	{/if}
</main>
