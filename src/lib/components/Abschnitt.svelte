<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';

	/**
	 * Abschnitt einer Seite: weiße Fläche mit zart getöntem Kopfband (Titel, optional Anzahl, Aktionen rechts).
	 * Trennt Bereiche sichtbar, ohne Linien unter Überschriften (Jamil msgs 2579–2583, 2597).
	 * Stile: `.abschnitt*` in stil/komponenten.css.
	 */
	let {
		titel,
		anzahl,
		id,
		ebene = 2,
		aktionen,
		info,
		children
	}: {
		titel: string;
		/** kleine Zahl neben dem Titel (z. B. Anzahl der Einträge) */
		anzahl?: number | null;
		id?: string;
		ebene?: 2 | 3;
		aktionen?: Snippet;
		/** Schlüssel in `$lib/einstellungs-infos.ts`: ⓘ neben dem Titel (Jamil msg 3423) */
		info?: string;
		children?: Snippet;
	} = $props();
	const titelId = $derived(id ? `${id}-titel` : undefined);
</script>

<section class="abschnitt" {id} aria-labelledby={titelId} aria-label={titelId ? undefined : titel}>
	<header class="abschnitt-kopf">
		<div class="abschnitt-titelzeile">
			<svelte:element this={`h${ebene}`} class="abschnitt-titel" id={titelId}>
				{titel}{#if anzahl != null}<span class="abschnitt-anzahl" aria-hidden="true">{anzahl}</span>{/if}
			</svelte:element>
			{#if info}<InfoFenster id={info} />{/if}
		</div>
		{#if aktionen}
			<div class="abschnitt-aktionen">{@render aktionen()}</div>
		{/if}
	</header>
	{#if children}
		<div class="abschnitt-inhalt">{@render children()}</div>
	{/if}
</section>

<style>
	.abschnitt-titelzeile {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
</style>
