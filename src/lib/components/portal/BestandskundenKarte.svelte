<script lang="ts">
	/**
	 * Karte „Leistungen für Bestandskunden“ (Jamil, Talk msg 3408) – klein und dezent, im Design des Kundenportals.
	 * EIN Baustein für das Portal und die Vorschau in den Einstellungen; Farben und Schriften kommen aus den
	 * Portal-Variablen (`--ui-akzent*`, `--pt-titel`, `--pt-gross`), nichts ist fest eingebaut. Texte stehen nur als
	 * Text im Dokument (nie als HTML). Links werden hier nochmals geprüft (nur https:, mailto:, tel:); https-Links
	 * öffnen in neuem Tab mit `rel="noopener noreferrer"`.
	 */
	import { BESTAND_SYMBOLE, pruefeLink, type BestandKarte } from '$lib/bestandskunden';
	import SkizzenKreis from './SkizzenKreis.svelte';

	let { karte, vorschau = false }: { karte: BestandKarte; vorschau?: boolean } = $props();

	/** letztes Wort der Überschrift in der Akzentfarbe – wie die übrigen Überschriften des Portals */
	const teile = $derived.by(() => {
		const t = karte.titel;
		const i = t.lastIndexOf(' ');
		return i < 0 ? { vorn: '', wort: t } : { vorn: t.slice(0, i + 1), wort: t.slice(i + 1) };
	});
	const knoepfe = $derived(
		karte.knoepfe.flatMap((k) => {
			const l = pruefeLink(k.url);
			return l.ok ? [{ text: k.text, url: l.url, extern: l.url.startsWith('https:') }] : [];
		})
	);
	const ohneSprung = (e: Event) => {
		if (vorschau) e.preventDefault();
	};
</script>

<section class="bk" aria-labelledby="bk-titel" data-testid="portal-nach-abschluss">
	<h2 id="bk-titel" class="bk-titel">{teile.vorn}<span class="bk-akzent">{teile.wort}</span></h2>
	{#if karte.text}<p class="bk-text">{karte.text}</p>{/if}
	{#if karte.leistungen.length > 0}
		<ul class="bk-liste" data-testid="bestand-leistungen">
			{#each karte.leistungen as l, i (i)}
				<li>
					<SkizzenKreis art="ring" groesse={34} seed={i + 11}>
						<svg class="bk-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d={BESTAND_SYMBOLE[l.symbol].pfad} /></svg>
					</SkizzenKreis>
					<span class="bk-name">
						<strong>{l.titel}</strong>
						{#if l.text}<small>{l.text}</small>{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if knoepfe.length > 0}
		<div class="bk-knoepfe" data-testid="bestand-knoepfe">
			{#each knoepfe as k, i (i)}
				<a class="bk-knopf" href={k.url} target={k.extern ? '_blank' : undefined} rel={k.extern ? 'noopener noreferrer' : undefined} onclick={ohneSprung}>{k.text}</a>
			{/each}
		</div>
	{/if}
</section>

<style>
	.bk {
		display: grid;
		gap: 0.5rem;
		padding: 0.8rem 1rem 0.9rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font-family: var(--pt-text, inherit);
	}
	.bk-titel {
		margin: 0;
		font-family: var(--pt-titel, var(--ui-schrift-titel));
		text-transform: var(--pt-gross, none);
		font-size: 1rem;
		line-height: 1.25;
		font-weight: 700;
	}
	.bk-akzent {
		color: var(--ui-akzent-text);
	}
	.bk-text {
		margin: 0;
		max-width: 46rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		line-height: 1.55;
	}
	.bk-liste {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 0.35rem 1rem;
		margin: 0.1rem 0 0;
		padding: 0;
		list-style: none;
	}
	.bk-liste li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		padding: 0.15rem 0;
	}
	.bk-symbol {
		display: block;
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: var(--ui-akzent-text);
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.bk-name {
		display: grid;
		min-width: 0;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.bk-name strong {
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.bk-name small {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
	}
	.bk-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}
	.bk-knopf {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 1.1rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-knopf-radius, 999px);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font-family: var(--pt-titel, var(--ui-schrift-titel));
		font-size: var(--ui-schrift-s);
		font-weight: 700;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.bk-knopf:hover {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent-zart);
	}
	.bk-knopf:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
</style>
