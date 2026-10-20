<script lang="ts">
	import { berlinUhrzeit } from '$lib/zeit';
	import type { HeuteEinsatz } from '$lib/heute-kopie';

	/**
	 * „Meine Einsätze heute“ als Karten: Uhrzeit, Kunde, Adresse (öffnet Google Maps in neuem Tab) und Auftrag.
	 * Wird auf „Start“ (frisch vom Server) und auf der Offline-Seite (Kopie vom Gerät) benutzt.
	 */
	let { einsaetze, offline = false }: { einsaetze: HeuteEinsatz[]; offline?: boolean } = $props();

	const karte = (ort: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ort)}`;
</script>

<ul class="heute-liste">
	{#each einsaetze as e (e.id)}
		<li class="heute-karte">
			<span class="heute-zeit">{berlinUhrzeit(new Date(e.beginn))}–{berlinUhrzeit(new Date(e.ende))}</span>
			<strong class="heute-kunde">{e.kundeName}</strong>
			{#if e.ort}
				<a class="heute-ort" href={karte(e.ort)} target="_blank" rel="noopener noreferrer">{e.ort}</a>
			{/if}
			{#if offline}
				<span class="heute-auftrag">{e.auftragNummer ? `${e.auftragNummer} · ` : ''}{e.auftragTitel}</span>
			{:else}
				{#if e.auftragId}<a class="heute-auftrag" href={`/auftraege/${e.auftragId}`}>{e.auftragNummer} · {e.auftragTitel}</a>{:else}<span class="heute-auftrag">📌 {e.auftragTitel} (eigener Termin)</span>{/if}
			{/if}
			{#if e.notiz}<span class="heute-notiz">{e.notiz}</span>{/if}
		</li>
	{:else}
		<li class="heute-leer">Heute keine Einsätze</li>
	{/each}
</ul>

<style>
	.heute-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.heute-karte {
		display: grid;
		gap: 0.2rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--rand);
		border-left: 5px solid var(--primaer);
		border-radius: 0.5rem;
		background: var(--flaeche);
	}
	.heute-zeit {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.heute-kunde {
		font-size: 1.05rem;
	}
	.heute-ort,
	a.heute-auftrag {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--ui-akzent-text);
	}
	.heute-auftrag {
		color: var(--text-leise);
	}
	.heute-notiz {
		color: var(--text-leise);
		font-size: 0.9rem;
		white-space: pre-wrap;
	}
	.heute-leer {
		padding: 0.75rem;
		border: 1px dashed var(--rand);
		border-radius: 0.5rem;
		color: var(--text-leise);
	}
</style>
