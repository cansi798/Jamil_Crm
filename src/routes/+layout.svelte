<script lang="ts">
	import '$lib/styles/basis.css';
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	import { beobachteAktualisierung } from '$lib/aktualisierung';

	let { children } = $props();

	// Neue Version nach einem Deploy automatisch übernehmen (src/lib/aktualisierung.ts): Ist die Seite veraltet
	// (neuer Service Worker oder neue SvelteKit-Version), wird der nächste Seitenwechsel ein vollständiger Seitenaufruf.
	let veraltet = () => false;
	onMount(() => {
		const a = beobachteAktualisierung({
			sw: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
			dok: document,
			neuLaden: () => location.reload(),
			pruefeVersion: () => updated.check()
		});
		veraltet = a.veraltet;
		return a.abmelden;
	});

	beforeNavigate(({ willUnload, to }) => {
		if (!willUnload && to?.url && (updated.current || veraltet())) location.href = to.url.href;
	});
</script>

{@render children()}
