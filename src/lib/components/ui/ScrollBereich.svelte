<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Eigener Scrollbereich für lange Listen wie den Verlauf (Jamil msg 3528: „Verlauf soll separat scrollbar sein“), damit die
	 * Seite nicht endlos lang wird. Feste Höchsthöhe (Desktop ca. 30 rem, Handy höher, damit man nicht in einer kleinen Box
	 * gefangen ist), ruhiger Scrollbalken, per Tastatur erreichbar (Tab, dann Pfeiltasten/Bild-Tasten) und für Screenreader
	 * als benannter Bereich. Ein Baustein für Auftrag und Kundenakte.
	 */
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollbarer Bereich muss per Tastatur erreichbar sein (WCAG 2.1.1) -->
<div class="scroll-bereich" role="region" aria-label={label} tabindex="0" data-testid="scroll-bereich">
	{@render children()}
</div>

<style>
	.scroll-bereich {
		max-height: min(30rem, 70vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: var(--ui-rand-stark, #c9c4ba) transparent;
		/* Platz für den Scrollbalken, ohne dass der Text springt */
		scrollbar-gutter: stable;
		padding-right: 0.25rem;
		border-radius: var(--ui-radius);
	}
	.scroll-bereich:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	/* Handy: höher, damit der Verlauf nicht in einer zu kleinen Box steckt */
	@media (max-width: 640px) {
		.scroll-bereich {
			max-height: 75vh;
		}
	}
</style>
