<script lang="ts">
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import { tagDeutsch } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Was ist neu</title></svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Was ist neu</h1>
			<p class="seiten-meta">Neue Funktionen in einem Satz – und wo Sie sie finden.</p>
		</div>
	</header>
	<Abschnitt titel="Neu im CRM" anzahl={data.eintraege.length}>
		<ul class="nw-liste">
			{#each data.eintraege as n (n.datum + n.titel)}
				<li data-testid="neuigkeit">
					<span class="nw-datum">{tagDeutsch(n.datum)}</span>
					<div class="nw-text">
						<strong>{n.titel}</strong>
						<span>{n.satz}</span>
						<small class="kd-info">Zu finden: <a href={n.href}>{n.wo}</a></small>
					</div>
				</li>
			{/each}
		</ul>
	</Abschnitt>
</main>

<style>
	.nw-liste {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.nw-liste li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.nw-datum {
		flex: 0 0 6.5rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.nw-text {
		display: grid;
		flex: 1 1 18rem;
		gap: 0.15rem;
		min-width: 0;
		line-height: 1.55;
	}
</style>
