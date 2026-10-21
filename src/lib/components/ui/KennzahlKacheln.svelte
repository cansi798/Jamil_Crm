<script lang="ts" module>
	export type Kachel = {
		id: string;
		titel: string;
		wert: string;
		/** kleine Zeile darunter (z. B. „im Zeitraum“, Trend) */
		info?: string | null;
		/** Klick filtert die Liste (Link mit Filter in der Adresse) */
		href?: string | null;
		/** Farbe des Randes (Status) */
		ton?: 'gruen' | 'orange' | 'rot' | 'blau' | 'lila' | 'grau' | 'akzent' | null;
	};
</script>

<script lang="ts">
	import Umschalter from './Umschalter.svelte';
	import { ZEITRAUM_ARTEN, ZEITRAUM_NAMEN, type ZeitraumArt } from '$lib/kennzahlen';

	/**
	 * Kennzahl-Kacheln oben auf Übersichtsseiten (Jamil msgs 2799/2801/2803): Zeitraum wählbar, Klick auf eine Kachel
	 * filtert die Liste darunter (aktive Kachel hervorgehoben, erneuter Klick hebt den Filter auf).
	 */
	let {
		kacheln,
		zeitraum,
		zeitraumLink,
		aktiv = null,
		label = 'Kennzahlen'
	}: {
		kacheln: Kachel[];
		zeitraum: ZeitraumArt;
		zeitraumLink: (art: ZeitraumArt) => string;
		aktiv?: string | null;
		label?: string;
	} = $props();
</script>

<section class="kz" aria-label={label}>
	<div class="kz-kopf">
		<span class="ui-eyebrow">{label} · {ZEITRAUM_NAMEN[zeitraum]}</span>
		<Umschalter
			label="Zeitraum"
			aktiv={zeitraum}
			eintraege={ZEITRAUM_ARTEN.map((a) => ({ wert: a, text: a === '12monate' ? '12 Monate' : a === 'alle' ? 'Gesamt' : ZEITRAUM_NAMEN[a].replace(/^(Dieser|Dieses) /, ''), href: zeitraumLink(a) }))}
		/>
	</div>
	<!-- bewusst keine Liste: Listenseiten (Tests, Screenreader) finden darunter weiter „die“ Liste der Einträge -->
	<div class="kz-reihe" role="group" aria-label={`${label}: Kennzahlen`}>
		{#each kacheln as k (k.id)}
			<div class="kz-zelle">
				{#if k.href}
					<a href={k.href} class={`kz-kachel ton-${k.ton ?? 'akzent'}`} class:aktiv={aktiv === k.id} aria-current={aktiv === k.id ? 'true' : undefined} data-sveltekit-noscroll>
						<span class="kz-titel">{k.titel}</span>
						<strong class="kz-wert">{k.wert}</strong>
						{#if k.info}<span class="kz-info">{k.info}</span>{/if}
					</a>
				{:else}
					<div class={`kz-kachel ton-${k.ton ?? 'akzent'}`}>
						<span class="kz-titel">{k.titel}</span>
						<strong class="kz-wert">{k.wert}</strong>
						{#if k.info}<span class="kz-info">{k.info}</span>{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.kz {
		margin: 0 0 var(--ui-abstand-block);
	}
	.kz-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem 0.75rem;
		margin-bottom: 0.5rem;
	}
	.kz-reihe {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.kz-kachel {
		display: grid;
		gap: 0.15rem;
		height: 100%;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--ui-rand);
		border-left: 4px solid var(--kz-ton);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
		color: var(--ui-text);
		text-decoration: none;
		transition: box-shadow 150ms, border-color 150ms, transform 150ms;
	}
	a.kz-kachel:hover {
		box-shadow: var(--ui-schatten-hoch);
		transform: translateY(-1px);
	}
	a.kz-kachel:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.kz-kachel.aktiv {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent-zart);
		box-shadow: inset 0 0 0 1px var(--ui-akzent);
	}
	.kz-titel {
		color: var(--ui-text-leise);
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.kz-wert {
		font-family: var(--ui-schrift-titel);
		font-size: 1.375rem;
		font-weight: 800;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}
	.kz-info {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
	}
	.ton-akzent { --kz-ton: var(--ui-akzent); }
	.ton-gruen { --kz-ton: var(--ui-gruen); }
	.ton-orange { --kz-ton: var(--ui-orange); }
	.ton-rot { --kz-ton: var(--ui-rot); }
	.ton-blau { --kz-ton: var(--ui-blau); }
	.ton-lila { --kz-ton: var(--ui-lila); }
	.ton-grau { --kz-ton: var(--ui-grau); }
	@media (max-width: 30rem) {
		.kz-reihe {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
