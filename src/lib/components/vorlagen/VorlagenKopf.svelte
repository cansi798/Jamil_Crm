<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';

	/**
	 * Kopf JEDER Vorlagen-Liste (Jamil msg 3084 – alle Vorlagen-Seiten gleich): Titel links (am Desktop steht er wie bei
	 * jeder Bereichs-Startseite nur in der Kopfleiste, msg 3060), darunter ein Satz, wofür die Vorlagen sind;
	 * „+ Neue Vorlage“ IMMER oben rechts – als Link (`neu.href`) oder als Formular-Aktion (`neu.aktion`, legt sofort an).
	 */
	let {
		titel,
		meta,
		neu,
		weitere
	}: {
		titel: string;
		meta: string;
		/** `null`: keine Berechtigung zum Anlegen */
		neu: { href: string } | { aktion: string } | null;
		/** weitere Aktionen links von „+ Neue Vorlage“ (selten) */
		weitere?: Snippet;
	} = $props();
</script>

<SeitenKopf {titel} {meta}>
	{#snippet aktionen()}
		{#if weitere}{@render weitere()}{/if}
		{#if neu && 'href' in neu}
			<a href={neu.href} class="kd-knopf" data-testid="vorlage-neu">+ Neue Vorlage</a>
		{:else if neu}
			<form method="POST" action={neu.aktion} use:enhance>
				<button type="submit" class="kd-knopf" data-testid="vorlage-neu">+ Neue Vorlage</button>
			</form>
		{/if}
	{/snippet}
</SeitenKopf>
