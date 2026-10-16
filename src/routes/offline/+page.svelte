<script lang="ts">
	import { onMount } from 'svelte';
	import HeuteListe from '$lib/components/HeuteListe.svelte';
	import { lade, type HeuteKopie } from '$lib/heute-kopie';
	import { berlinUhrzeit, tagKurz } from '$lib/zeit';

	/**
	 * Offline-Seite: Der Service Worker zeigt sie, wenn eine Seite ohne Netz nicht geladen werden kann. Die Seite selbst
	 * ist statisch; die Einsätze von heute kommen aus der Kopie auf diesem Gerät (`localStorage`, siehe heute-kopie.ts).
	 */
	let kopie = $state<HeuteKopie | null>(null);
	let geladen = $state(false);

	onMount(() => {
		kopie = lade(new Date());
		geladen = true;
	});
</script>

<svelte:head>
	<title>Offline – CRM System</title>
</svelte:head>

<main class="offline">
	{#if geladen && kopie}
		<h1>Offline – Stand {berlinUhrzeit(new Date(kopie.stand))}</h1>
		<p class="leise">Keine Verbindung. Das sind Ihre Einsätze von heute ({tagKurz(kopie.tag)}), wie zuletzt geladen.</p>
		<HeuteListe einsaetze={kopie.einsaetze} offline />
	{:else if geladen}
		<h1>Keine Verbindung</h1>
		<p class="leise">Die Seite kann gerade nicht geladen werden. Bitte die Verbindung prüfen und es erneut versuchen.</p>
	{/if}
	<p><a href="/" class="knopf">Erneut versuchen</a></p>
</main>

<style>
	.offline {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}
	h1 {
		font-size: 1.4rem;
		margin: 0.5rem 0;
	}
	.leise {
		color: var(--text-leise);
	}
	p:last-child {
		margin-top: 1.5rem;
	}
</style>
