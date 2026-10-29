<script lang="ts">
	import type { Snippet } from 'svelte';
	import PortalKopf from './PortalKopf.svelte';
	import { farbStil } from '$lib/farbe';
	import { kopfIstHell } from '$lib/portal-kopf';
	import { portalMarkeStil, type PortalMarke } from '$lib/portal-marke';

	/**
	 * Gemeinsame Hülle im Design des Kundenportals – Kundenportal UND Online-Buchung (STÄNDIGE Regel von Jamil, msg 3662:
	 * „Online-Buchungsseiten immer im Design des Kundenportals“). Hier stehen Farben (Hausfarbe, Kopffarbe, Hintergrund),
	 * Schriften, Kopf (`PortalKopf`), Fuß und die Grundbausteine: Überschriften (`.pt-akzent` für das Akzentwort),
	 * `.pt-eyebrow`, Karten `.pt-karte`, Knöpfe `.pt-knopf` (`.hell`), Eingabefelder in `.pt-form`/`.pt-felder`.
	 * Wer das Portal-Design ändert, ändert es hier – dann kommt es überall an. Seitenspezifisches bleibt in den Seiten.
	 */
	let {
		name,
		akzent,
		marke,
		logo,
		untertitel = 'Ihr Kundenportal',
		kopfKlasse = '',
		breite = 'weit',
		kontakt = null,
		vollhoehe = true,
		element = $bindable(),
		children
	}: {
		name: string;
		/** Hausfarbe des Betriebs (leer = Standard des Portals) */
		akzent: string | null;
		marke: PortalMarke;
		logo: { src: string; feld: 'weiss' | 'dunkel' | null } | null;
		/** kleine Zeile neben dem Logo („Ihr Kundenportal“, „Online-Terminbuchung“) */
		untertitel?: string;
		kopfKlasse?: string;
		/** weit = Portal (72rem), schmal = Buchung (40rem) */
		breite?: 'weit' | 'schmal';
		kontakt?: { telefon: string | null; email: string | null; web: string | null; datenschutzUrl?: string | null } | null;
		/** mindestens Fensterhöhe (eingebettet im iframe aus, sonst wächst das iframe nur noch) */
		vollhoehe?: boolean;
		element?: HTMLElement;
		children: Snippet;
	} = $props();

	const STANDARD_AKZENT = '#c3a56f';
	const stil = $derived(
		[farbStil(akzent || STANDARD_AKZENT), '--ui-akzent-dunkel: var(--ui-akzent-text)', ...portalMarkeStil(marke), `--pt-breite: ${breite === 'schmal' ? '40rem' : '72rem'}`].join('; ')
	);
	const sicher = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);
	const webLink = $derived(kontakt?.web ? (/^https?:\/\//i.test(kontakt.web) ? kontakt.web : `https://${kontakt.web}`) : null);
	const telLink = $derived(kontakt?.telefon ? `tel:${kontakt.telefon.replace(/[^0-9+]/g, '')}` : null);
</script>

<div class="pt" class:gross={marke.titelGross} class:vollhoehe style={stil} bind:this={element}>
	<PortalKopf klasse={kopfKlasse} {name} hell={kopfIstHell(marke.dunkel)} {logo} {untertitel} />
	{@render children()}
	{#if kontakt}
		<footer class="pt-fuss">
			<span>{name}</span>
			{#if kontakt.telefon}<a href={telLink}>{kontakt.telefon}</a>{/if}
			{#if kontakt.email}<a href={`mailto:${kontakt.email}`}>{kontakt.email}</a>{/if}
			{#if webLink}<a href={webLink} target="_blank" rel="noopener noreferrer">{kontakt.web}</a>{/if}
			{#if sicher(kontakt.datenschutzUrl)}<a href={sicher(kontakt.datenschutzUrl)} target="_blank" rel="noopener noreferrer">Datenschutz</a>{/if}
		</footer>
	{/if}
</div>

<style>
	:global(body) {
		background: var(--ui-hintergrund);
	}
	.pt.vollhoehe {
		min-height: 100vh;
	}
	.pt {
		background: var(--pt-grund);
		color: var(--ui-text);
		font-family: var(--pt-text);
	}
	/*
	 * Grundbausteine mit :where(.pt) – Spezifität wie eine einfache Klasse, damit seitenspezifische Regeln
	 * (z. B. .pt-erledigen auf einer .pt-karte) wie bisher gewinnen.
	 */
	/* Überschriften wie die Website des Betriebs (Schrift, Großbuchstaben, letztes Wort in der Akzentfarbe) */
	:where(.pt) :global(:is(h1, h2, h3)) {
		font-family: var(--pt-titel);
		text-transform: var(--pt-gross);
	}
	:where(.gross) :global(:is(h1, h2)) {
		letter-spacing: 0.02em;
		font-weight: 800;
	}
	:where(.pt) :global(.pt-akzent) {
		color: var(--ui-akzent-text);
	}
	:where(.pt) :global(.pt-eyebrow) {
		display: block;
		color: var(--ui-akzent-text);
		font-family: var(--pt-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	/* Inhalt und Fuß in derselben Breite wie der Kopf */
	:where(.pt) :global(.pt-inhalt),
	.pt-fuss {
		max-width: var(--pt-breite);
		margin: 0 auto;
		padding-left: 16px;
		padding-right: 16px;
		box-sizing: border-box;
	}
	:where(.pt) :global(.pt-karte) {
		display: grid;
		/* eine Spalte, die nie breiter als die Karte wird (z. B. waagerecht scrollende Tagesleiste der Buchung) */
		grid-template-columns: minmax(0, 1fr);
		gap: 0.55rem;
		padding: 1rem 1.1rem;
		border-radius: var(--ui-radius-karte);
		border: 1px solid var(--ui-rand);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
		animation: pt-rein 0.5s ease-out both;
	}
	/* Eingabefelder */
	:where(.pt) :global(:is(.pt-form, .pt-felder) label) {
		display: grid;
		gap: 0.25rem;
	}
	:where(.pt) :global(:is(.pt-form, .pt-felder) :is(input:not([type='checkbox']):not([type='radio']), textarea)) {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		font: inherit;
		padding: 0 0.6rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
	}
	:where(.pt) :global(:is(.pt-form, .pt-felder) textarea) {
		padding: 0.6rem;
	}
	:where(.pt) :global(:is(.pt-form, .pt-felder) :is(input, textarea):focus-visible) {
		outline: none;
		border-color: var(--ui-akzent);
		box-shadow: var(--ui-fokus-ring);
	}
	/* Knöpfe */
	:where(.pt) :global(.pt-knopf) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 1.25rem;
		border: 0;
		border-radius: var(--ui-knopf-radius);
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font: inherit;
		font-family: var(--pt-titel);
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	:where(.gross) :global(.pt-knopf) {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.875rem;
	}
	:where(.pt) :global(.pt-knopf:hover) {
		background: var(--ui-akzent-hover);
	}
	:where(.pt) :global(.pt-knopf.hell) {
		background: var(--ui-flaeche);
		color: var(--ui-text);
		border: 1px solid var(--ui-rand-stark);
	}
	:where(.pt) :global(.pt-knopf:disabled) {
		opacity: 0.6;
		cursor: default;
	}
	:where(.pt) :global(.pt-knopf:focus-visible) {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.pt-fuss {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		padding-top: 1rem;
		padding-bottom: 2rem;
		border-top: 1px solid var(--ui-rand);
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.pt-fuss a {
		color: var(--ui-text-leise);
	}
	@keyframes -global-pt-rein {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:where(.pt) :global(.pt-karte) {
			animation: none;
		}
	}
</style>
