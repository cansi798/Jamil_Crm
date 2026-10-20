<script lang="ts">
	import { onMount } from 'svelte';
	import { berlinUhrzeit, tagKurz } from '$lib/zeit';

	/**
	 * Termin wählen (Online-Buchung): lädt freie Zeiten von `url` (`?von=JJJJ-MM-TT`, je 14 Tage), zeigt die Tage als
	 * Leiste und die Anfangszeiten als große Knöpfe (Handy zuerst). „Weitere Termine“ lädt die nächsten 14 Tage.
	 */
	type Termine = { tage: { tag: string; zeiten: { beginn: string; ende: string }[] }[]; naechsterVon: string | null; bisTag: string };

	let { url, gewaehlt = $bindable(null) }: { url: string; gewaehlt?: string | null } = $props();

	let seiten = $state<{ von: string | null; daten: Termine }[]>([]);
	let index = $state(0);
	let laedt = $state(false);
	let fehler = $state<string | null>(null);
	let tag = $state<string | null>(null);

	const aktuell = $derived(seiten[index]?.daten ?? null);
	const tagDaten = $derived(aktuell?.tage.find((t) => t.tag === tag) ?? null);

	async function lade(von: string | null) {
		laedt = true;
		fehler = null;
		try {
			const r = await fetch(`${url}${von ? `?von=${encodeURIComponent(von)}` : ''}`, { headers: { accept: 'application/json' } });
			const b = await r.json();
			if (!r.ok) throw new Error(b.fehler ?? 'Termine konnten nicht geladen werden.');
			seiten = [...seiten.slice(0, index + (seiten.length ? 1 : 0)), { von, daten: b }];
			index = seiten.length - 1;
			tag = b.tage[0]?.tag ?? null;
		} catch (e) {
			fehler = e instanceof Error ? e.message : 'Termine konnten nicht geladen werden.';
		} finally {
			laedt = false;
		}
	}
	/** Nach einem „vergeben“ neu laden (vom Elternteil aufgerufen). */
	export async function neuLaden() {
		const von = seiten[index]?.von ?? null;
		seiten = seiten.slice(0, index);
		index = Math.max(0, index - 1);
		gewaehlt = null;
		await lade(von);
	}
	onMount(() => lade(null));
	const tagText = (t: string) => tagKurz(t).replace(' ', ' ');
</script>

<div class="tw">
	{#if fehler}
		<p class="kd-fehler" role="alert">{fehler}</p>
		<button type="button" class="kd-knopf hell" onclick={() => lade(seiten[index]?.von ?? null)}>Erneut versuchen</button>
	{:else if !aktuell && laedt}
		<p class="kd-info" role="status">Freie Termine werden geladen …</p>
	{:else if aktuell}
		{#if aktuell.tage.length === 0}
			<p class="tw-leer">In diesem Zeitraum ist leider nichts frei.</p>
		{:else}
			<div class="tw-tage" role="tablist" aria-label="Tag wählen">
				{#each aktuell.tage as t (t.tag)}
					<button
						type="button"
						role="tab"
						class="tw-tag"
						class:an={t.tag === tag}
						aria-selected={t.tag === tag}
						onclick={() => (tag = t.tag)}
						data-tag={t.tag}
					>
						<span>{tagText(t.tag)}</span>
						<small>{t.zeiten.length} frei</small>
					</button>
				{/each}
			</div>
			{#if tagDaten}
				<div class="tw-zeiten" role="group" aria-label={`Uhrzeit am ${tagKurz(tagDaten.tag)}`}>
					{#each tagDaten.zeiten as z (z.beginn)}
						<button
							type="button"
							class="tw-zeit"
							class:an={gewaehlt === z.beginn}
							aria-pressed={gewaehlt === z.beginn}
							onclick={() => (gewaehlt = gewaehlt === z.beginn ? null : z.beginn)}
							data-beginn={z.beginn}>{berlinUhrzeit(new Date(z.beginn))}</button
						>
					{/each}
				</div>
			{/if}
		{/if}
		<div class="tw-blaettern">
			{#if index > 0}
				<button type="button" class="knopf-subtil" onclick={() => ((index -= 1), (tag = seiten[index].daten.tage[0]?.tag ?? null))}>← Frühere Termine</button>
			{/if}
			{#if aktuell.naechsterVon}
				<button
					type="button"
					class="knopf-subtil"
					disabled={laedt}
					onclick={() => (seiten[index + 1] ? ((index += 1), (tag = seiten[index].daten.tage[0]?.tag ?? null)) : lade(aktuell.naechsterVon))}
					>Weitere Termine →</button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tw-tage {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		padding: 0.25rem 0 0.5rem;
		scroll-snap-type: x proximity;
	}
	.tw-tag {
		display: grid;
		flex: none;
		gap: 0.1rem;
		min-width: 4.75rem;
		min-height: 3.25rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		scroll-snap-align: start;
	}
	.tw-tag small {
		font-weight: 400;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
	}
	.tw-tag.an {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
	}
	.tw-tag.an small {
		color: #fff;
	}
	.tw-zeiten {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.25rem, 1fr));
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.tw-zeit {
		min-height: 2.75rem;
		border: 1px solid var(--ui-akzent);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-akzent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.tw-zeit:hover {
		background: var(--ui-akzent-hell);
	}
	.tw-zeit.an {
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
	}
	.tw-tag:focus-visible,
	.tw-zeit:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.tw-blaettern {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.tw-leer {
		color: var(--ui-text-leise);
	}
</style>
