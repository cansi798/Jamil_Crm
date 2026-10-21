<script lang="ts">
	import { mitEinstellungen } from '$lib/kennzahlen';
	import KennzahlKacheln, { type Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import BelegReiter from '$lib/components/ausgangsbelege/BelegReiter.svelte';
	import { tagDeutsch } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS_NAMEN: Record<string, string> = { bereit: 'Bereit zum Versand', gesendet: 'Versendet' };
	const PFAD = '/ausgangsbelege/auftragsbestaetigungen';
	const aLink = (o: { status?: string | null; zeitraum?: string }) => {
		const p = new URLSearchParams();
		if (data.suche) p.set('suche', data.suche);
		const st = o.status === undefined ? data.status : o.status;
		if (st) p.set('status', st);
		const z = o.zeitraum ?? data.zeitraum;
		if (z !== 'monat') p.set('zeitraum', z);
		const q = p.toString();
		return q ? `${PFAD}?${q}` : PFAD;
	};
	const tag = (iso: string) => tagDeutsch(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso)));

	const kacheln = $derived.by((): Kachel[] => {
		const kz = data.kennzahlen;
		if (!kz) return [];
		const KONFIG: Record<string, string> = { bereit: 'ab_bereit', gesendet: 'ab_versendet', erstellt: 'ab_erstellt' };
		return mitEinstellungen<Kachel>([
			{ id: 'bereit', titel: 'Bereit zum Versand', wert: String(kz.bereit), info: 'jetzt', ton: 'orange', href: aLink({ status: data.status === 'bereit' ? null : 'bereit' }) },
			{ id: 'gesendet', titel: 'Versendet', wert: String(kz.versendet), info: 'im Zeitraum', ton: 'gruen', href: aLink({ status: data.status === 'gesendet' ? null : 'gesendet' }) },
			{ id: 'erstellt', titel: 'Erstellt', wert: String(kz.erstellt), info: 'im Zeitraum', ton: 'akzent', href: null }
		], kz, (id) => KONFIG[id] ?? id);
	});
</script>

<svelte:head>
	<title>Auftragsbestätigungen · Ausgangsbelege</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Ausgangsbelege</h1>
			<p class="seiten-meta">Auftragsbestätigungen entstehen automatisch, wenn ein Angebot angenommen wird.</p>
		</div>
	</header>

	<FilterLeiste ansichten="auftragsbestaetigungen" label="Auftragsbestätigungen filtern">
		{#snippet suche()}
			<SuchFeld wert={data.suche} label="Auftragsbestätigungen suchen" placeholder="Nummer, Auftrag oder Kunde" />
			{#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
			{#if data.zeitraum !== 'monat'}<input type="hidden" name="zeitraum" value={data.zeitraum} />{/if}
		{/snippet}
		{#snippet filter()}
			<BelegReiter aktiv="auftragsbestaetigungen" />
			<Umschalter
				label="Status"
				aktiv={data.status ?? 'alle'}
				eintraege={[
					{ wert: 'alle', text: 'Alle', href: aLink({ status: null }) },
					{ wert: 'bereit', text: STATUS_NAMEN.bereit, href: aLink({ status: 'bereit' }) },
					{ wert: 'gesendet', text: STATUS_NAMEN.gesendet, href: aLink({ status: 'gesendet' }) }
				]}
			/>
		{/snippet}
	</FilterLeiste>

	{#if kacheln.length > 0}
		<KennzahlKacheln label="Auftragsbestätigungen" {kacheln} zeitraum={data.zeitraum} zeitraumLink={(a) => aLink({ zeitraum: a })} aktiv={data.status} />
	{/if}

	<ul class="kd-liste ab-liste">
		{#each data.abs as ab (ab.id)}
			<li data-ab={ab.nummer}>
				<a href={ab.auftrag ? `/auftraege/${ab.auftrag.id}` : `/angebote/${ab.angebotId}`}>
					<span class="af-kopfzeile">
						<strong>{ab.nummer} · {ab.kundeName}</strong>
						<span class={`an-status s-${ab.versandStatus === 'gesendet' ? 'angenommen' : 'versendet'}`}>{STATUS_NAMEN[ab.versandStatus]}</span>
					</span>
					<span class="af-kopfzeile">
						<span class="kd-info">
							{ab.auftrag ? `${ab.auftrag.nummer} · ${ab.auftrag.titel}` : 'ohne Auftrag'} · {tag(ab.angelegt)}
							{#if ab.versendetAm} · versendet {tag(ab.versendetAm)}{/if}
						</span>
					</span>
				</a>
				<a class="kd-knopf hell klein ab-pdf" href={`/api/auftragsbestaetigungen/${ab.id}/pdf`} target="_blank" rel="noopener" aria-label={`PDF ${ab.nummer} öffnen`}>PDF</a>
			</li>
		{:else}
			<li class="kd-leer">
				{data.status || data.suche ? 'Keine Auftragsbestätigungen für diesen Filter.' : 'Noch keine Auftragsbestätigungen – sie entstehen, sobald ein Angebot angenommen wird.'}
			</li>
		{/each}
	</ul>
	{#if data.abs.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Auftragsbestätigungen angezeigt.</p>
	{/if}
</main>

<style>
	.ab-liste li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ab-liste li > a:first-child {
		flex: 1;
		min-width: 0;
	}
	.ab-pdf {
		flex: none;
		margin-right: 8px;
	}
</style>
