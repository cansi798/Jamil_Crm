<script lang="ts">
	/**
	 * DER Umschalter der App (docs/design-regeln.md): Ansicht (Board/Liste, Monat/Woche/Tag/Team), Status-Chips,
	 * Meine/Alle … – überall gleich hoch und gleich gestaltet. Mit `href` je Eintrag als Navigation (aria-current),
	 * sonst als Knöpfe (aria-pressed) mit `onwaehle`. Formularfelder: ui/Segmente (gleicher Stil, echte Radios).
	 */
	type Eintrag = { wert: string; text: string; href?: string };
	let {
		eintraege,
		aktiv,
		label,
		onwaehle
	}: { eintraege: readonly Eintrag[]; aktiv: string | null; label: string; onwaehle?: (wert: string) => void } = $props();
	const alsLinks = $derived(eintraege.every((e) => e.href));
</script>

{#if alsLinks}
	<nav class="ui-umschalter" aria-label={label}>
		{#each eintraege as e (e.wert)}
			<a href={e.href} aria-current={e.wert === aktiv ? 'page' : undefined} data-sveltekit-noscroll data-sveltekit-keepfocus>{e.text}</a>
		{/each}
	</nav>
{:else}
	<div class="ui-umschalter" role="group" aria-label={label}>
		{#each eintraege as e (e.wert)}
			<button type="button" aria-pressed={e.wert === aktiv} onclick={() => onwaehle?.(e.wert)}>{e.text}</button>
		{/each}
	</div>
{/if}
