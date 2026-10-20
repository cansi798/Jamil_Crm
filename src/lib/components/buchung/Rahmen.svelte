<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';

	/**
	 * Rahmen der öffentlichen Buchungsseiten (Online-Buchung): Kopf mit Logo und Firmenname in der Hausfarbe, Inhalt,
	 * Fuß mit Kontakt und Datenschutz. Die Hausfarbe setzt die Design-Tokens (`--ui-akzent` …) nur hier drin.
	 * Eingebettet (iframe) meldet die Seite ihre Höhe an die Website (postMessage `crm-buchung-hoehe`), damit das
	 * iframe ohne Scrollbalken mitwächst.
	 */
	let {
		betrieb,
		farben,
		logoUrl,
		datenschutzUrl = null,
		children
	}: {
		betrieb: { name: string; telefon: string | null; email: string | null; web: string | null; hatLogo: boolean };
		farben: { akzent: string; hover: string; dunkel: string; hell: string; zart: string };
		logoUrl: string | null;
		datenschutzUrl?: string | null;
		children: Snippet;
	} = $props();

	const stil = $derived(
		`--ui-akzent:${farben.akzent};--ui-akzent-hover:${farben.hover};--ui-akzent-dunkel:${farben.dunkel};--ui-akzent-hell:${farben.hell};--ui-akzent-zart:${farben.zart};--ui-fokus-ring:0 0 0 3px ${farben.hell};`
	);
	const webLink = $derived(betrieb.web ? (/^https?:\/\//i.test(betrieb.web) ? betrieb.web : `https://${betrieb.web}`) : null);
	const sichererLink = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

	let wurzel = $state<HTMLElement>();
	onMount(() => {
		if (window.parent === window || !wurzel) return;
		let letzte = 0;
		const melden = () => {
			const h = Math.ceil(document.documentElement.scrollHeight);
			if (Math.abs(h - letzte) < 2) return;
			letzte = h;
			window.parent.postMessage({ typ: 'crm-buchung-hoehe', hoehe: h }, '*');
		};
		const ro = new ResizeObserver(melden);
		ro.observe(wurzel);
		melden();
		return () => ro.disconnect();
	});
</script>

<div class="bu-rahmen" style={stil} bind:this={wurzel}>
	<header class="bu-kopf">
		{#if betrieb.hatLogo && logoUrl}
			<img class="bu-logo" src={logoUrl} alt={`Logo ${betrieb.name}`} />
		{/if}
		<span class="bu-firma">{betrieb.name}</span>
	</header>
	<main class="bu-inhalt">
		{@render children()}
	</main>
	<footer class="bu-fuss">
		<span>{betrieb.name}</span>
		{#if betrieb.telefon}<a href={`tel:${betrieb.telefon.replace(/[^\d+]/g, '')}`}>{betrieb.telefon}</a>{/if}
		{#if betrieb.email}<a href={`mailto:${betrieb.email}`}>{betrieb.email}</a>{/if}
		{#if webLink}<a href={webLink} target="_blank" rel="noopener noreferrer">{betrieb.web}</a>{/if}
		{#if sichererLink(datenschutzUrl)}<a href={sichererLink(datenschutzUrl)} target="_blank" rel="noopener noreferrer">Datenschutz</a>{/if}
	</footer>
</div>

<style>
	:global(body) {
		background: var(--ui-hintergrund);
	}
	.bu-rahmen {
		max-width: 40rem;
		margin: 0 auto;
		padding: 0 0 1.5rem;
		color: var(--ui-text);
	}
	.bu-kopf {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1rem 0.85rem;
		border-bottom: 4px solid var(--ui-akzent);
		background: var(--ui-flaeche);
	}
	.bu-logo {
		max-height: 3rem;
		max-width: 10rem;
		object-fit: contain;
	}
	.bu-firma {
		font-weight: 700;
		font-size: var(--ui-schrift-l);
	}
	.bu-inhalt {
		padding: 1rem;
	}
	.bu-fuss {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		padding: 1rem;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.bu-fuss a {
		color: var(--ui-text-leise);
	}
</style>
