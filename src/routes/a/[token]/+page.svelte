<script lang="ts">
	import type { PageData } from './$types';
	import { telefonLink } from '$lib/kontakt-links';

	let { data }: { data: PageData } = $props();
	const k = $derived(data.gefunden ? data.kontakt : null);
	const tel = $derived(telefonLink(k?.telefon));
	const web = $derived(k?.web ? (/^https?:\/\//i.test(k.web) ? k.web : `https://${k.web}`) : null);
	const betreff = $derived(data.gefunden ? `Störung ${data.typName}` : 'Störung');
</script>

<svelte:head>
	<title>Störung melden</title>
	<meta name="robots" content="noindex" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main>
	{#if !data.gefunden}
		<h1>Code nicht gefunden</h1>
		<p>Dieser QR-Code ist unbekannt oder die Anlage wurde entfernt.</p>
	{:else}
		<p class="typ">{data.typName}</p>
		<h1>Störung melden</h1>
		<p>Funktioniert die Anlage nicht richtig? Melden Sie sich bitte direkt bei uns – wir kümmern uns darum.</p>

		<section class="kontakt" aria-label="Kontakt">
			{#if k?.firmenname}<p class="firma">{k.firmenname}</p>{/if}
			{#if tel}
				<a class="knopf" href={tel}>Anrufen: {k?.telefon}</a>
			{/if}
			{#if k?.email}
				<a class="knopf zweit" href={`mailto:${k.email}?subject=${encodeURIComponent(betreff)}`}>E-Mail: {k.email}</a>
			{/if}
			{#if web}
				<a class="link" href={web} rel="noopener noreferrer">{k?.web}</a>
			{/if}
			{#if !tel && !k?.email && !web}
				<p>Bitte wenden Sie sich an Ihren Handwerksbetrieb.</p>
			{/if}
		</section>
		<p class="hinweis">Online-Tickets folgen in Kürze.</p>
	{/if}
	{#if !data.angemeldet}
		<p class="mitarbeiter">Mitarbeiter? <a href="/anmelden">Anmelden</a> und den Code erneut scannen.</p>
	{/if}
</main>

<style>
	main {
		max-width: 28rem;
		margin: 2rem auto;
		padding: 0 1rem;
		line-height: 1.6;
	}
	h1 {
		margin: 0.25rem 0 0.75rem;
	}
	.typ {
		margin: 0;
		color: #5b6168;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.85rem;
	}
	.kontakt {
		display: grid;
		gap: 0.75rem;
		margin: 1.5rem 0;
		padding: 1rem;
		border: 1px solid #c9ced5;
		border-radius: 0.5rem;
	}
	.firma {
		margin: 0;
		font-weight: 700;
	}
	.knopf {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		border-radius: 0.4rem;
		background: #0f6cbd;
		color: #fff;
		text-decoration: none;
		font-weight: 600;
		text-align: center;
		overflow-wrap: anywhere;
	}
	.knopf.zweit {
		background: #fff;
		color: #0f6cbd;
		border: 1px solid #0f6cbd;
	}
	.link {
		overflow-wrap: anywhere;
	}
	.hinweis,
	.mitarbeiter {
		font-size: 0.9rem;
		color: #5b6168;
	}
</style>
