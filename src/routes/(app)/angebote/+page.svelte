<script lang="ts">
	import { mitEinstellungen } from '$lib/kennzahlen';
	import KennzahlKacheln, { type Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import { ANGEBOT_STATUS, ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	const aLink = (o: { status?: string | null; zeitraum?: string }) => {
		const p = new URLSearchParams();
		const st = o.status === undefined ? data.status : o.status;
		if (st) p.set('status', st);
		const z = o.zeitraum ?? data.zeitraum;
		if (z !== 'monat') p.set('zeitraum', z);
		const q = p.toString();
		return q ? `/angebote?${q}` : '/angebote';
	};
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const prozent = (w: number | null) => (w === null ? '–' : `${Math.round(w * 100)} %`);
	const kacheln = $derived.by((): Kachel[] => {
		const kz = data.kennzahlen;
		if (!kz) return [];
		const kl = (id: string, titel: string, wert: string, info: string, ton: Kachel['ton'], filter: boolean) => ({
			id, titel, wert, info, ton, href: filter ? aLink({ status: data.status === id ? null : id }) : null
		});
		// Einstellungen je Kennzahl (Jamil msg 2946)
		const KONFIG: Record<string, string> = { entwurf: 'angebote_entwurf', versendet: 'angebote_offen', angenommen: 'angebote_angenommen', abgelehnt: 'angebote_abgelehnt', abgelaufen: 'angebote_abgelaufen', quote: 'angebote_quote', schnitt: 'angebote_schnitt' };
		return mitEinstellungen([
			kl('entwurf', 'Entwürfe', String(kz.entwurf), 'jetzt', 'grau', true),
			kl('versendet', 'Offen', String(kz.offen), kz.summeOffenCent !== null ? euro(kz.summeOffenCent) : 'versendet, gültig', 'blau', true),
			kl('angenommen', 'Angenommen', String(kz.angenommen), kz.summeAngenommenCent !== null ? euro(kz.summeAngenommenCent) : 'im Zeitraum', 'gruen', true),
			kl('abgelehnt', 'Abgelehnt', String(kz.abgelehnt), 'im Zeitraum', 'rot', true),
			kl('abgelaufen', 'Abgelaufen', String(kz.abgelaufen), 'ohne Antwort', 'orange', false),
			kl('quote', 'Annahmequote', prozent(kz.quote.wert), kz.quote.fehlt ?? 'im Zeitraum', 'akzent', false),
			...(kz.durchschnittCent !== null ? [kl('schnitt', 'Ø Angebotswert', euro(kz.durchschnittCent), 'im Zeitraum abgegeben', 'akzent', false)] : [])
		], kz, (id) => KONFIG[id] ?? id);
	});
</script>

<svelte:head>
	<title>Angebote</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Angebote</h1>
			<p class="seiten-meta">Meist im Auftrag erstellt – ein Angebot ohne Auftrag lässt sich später zuordnen.</p>
		</div>
		{#if data.darfOhneAuftrag}
			<form method="POST" action="?/neu" use:enhance class="seiten-aktionen">
				<button type="submit" class="kd-knopf" aria-label="+ Angebot ohne Auftrag">+ Angebot</button>
			</form>
		{/if}
	</header>
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	<FilterLeiste ansichten="angebote" form={false} label="Angebote filtern">
		{#snippet filter()}
			<Umschalter
				label="Status"
				aktiv={data.status ?? 'alle'}
				eintraege={[{ wert: 'alle', text: 'Alle', href: aLink({ status: null }) }, ...ANGEBOT_STATUS.map((st) => ({ wert: st, text: ANGEBOT_STATUS_NAMEN[st], href: aLink({ status: st }) }))]}
			/>
		{/snippet}
	</FilterLeiste>

	{#if kacheln.length > 0}
		<KennzahlKacheln label="Angebote" {kacheln} zeitraum={data.zeitraum} zeitraumLink={(a) => aLink({ zeitraum: a })} aktiv={data.status} />
	{/if}

	<ul class="kd-liste">
		{#each data.angebote as a (a.id)}
			<li>
				<a href={`/angebote/${a.id}`}>
					<span class="af-kopfzeile">
						<strong>{a.nummer} · {a.kundeName}</strong>
						<span class={`an-status s-${a.status}`}>{ANGEBOT_STATUS_NAMEN[a.status]}</span>
					</span>
					<span class="af-kopfzeile">
						<span class="kd-info">{a.auftragTitel ?? 'ohne Auftrag'} · {tagDeutsch(a.datum)}</span>
						<span class="kt-preis">{euro(a.bruttoCent)}</span>
					</span>
					{#if a.warnungen.includes('preis_fehlt')}<span class="kt-preis-fehlt">Preis fehlt</span>{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">{data.status ? 'Keine Angebote in diesem Status.' : 'Noch keine Angebote.'}</li>
		{/each}
	</ul>
	{#if data.angebote.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Angebote angezeigt.</p>
	{/if}
</main>
