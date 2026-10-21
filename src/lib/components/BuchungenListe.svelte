<script lang="ts">
	/**
	 * „Kommende Buchungen“ (Online-Buchung, Terminart): oben nur gültige Buchungen – die Zahl im Kopf zählt genau diese.
	 * Vom Kunden abgesagte stehen eingeklappt darunter unter „Abgesagt“ (Jamil msgs 3075/3076).
	 */
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import { berlinTag, berlinUhrzeit, tagKurz } from '$lib/zeit';

	type Buchung = {
		id: string;
		dienstName: string;
		beginn: string;
		status: 'aktiv' | 'storniert';
		kundeName: string;
		mitarbeiterName: string;
		auftragId: string | null;
	};
	let { buchungen, mitTerminart = true, leer = 'Keine kommenden Buchungen.' }: { buchungen: Buchung[]; mitTerminart?: boolean; leer?: string } = $props();

	const aktive = $derived(buchungen.filter((b) => b.status === 'aktiv'));
	const abgesagt = $derived(buchungen.filter((b) => b.status !== 'aktiv'));
	const wann = (iso: string) => `${tagKurz(berlinTag(new Date(iso)))} ${berlinUhrzeit(new Date(iso))}`;
</script>

{#snippet zeile(b: Buchung)}
	<li>
		<span class="bl-wann">{wann(b.beginn)}</span>
		<span>{mitTerminart ? `${b.dienstName} – ` : ''}{b.kundeName}</span>
		<span class="kd-info">{b.mitarbeiterName}</span>
		{#if b.auftragId}<a href={`/auftraege/${b.auftragId}`}>Auftrag</a>{/if}
	</li>
{/snippet}

<Abschnitt titel="Kommende Buchungen" anzahl={aktive.length}>
	{#if aktive.length === 0}
		<p class="kd-leer">{leer}</p>
	{:else}
		<ul class="kd-liste bl-liste" aria-label="Kommende Buchungen">
			{#each aktive as b (b.id)}{@render zeile(b)}{/each}
		</ul>
	{/if}
	{#if abgesagt.length > 0}
		<details class="bl-abgesagt">
			<summary>Abgesagt ({abgesagt.length})</summary>
			<ul class="kd-liste bl-liste" aria-label="Abgesagte Buchungen">
				{#each abgesagt as b (b.id)}{@render zeile(b)}{/each}
			</ul>
		</details>
	{/if}
</Abschnitt>

<style>
	.bl-liste li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.bl-wann {
		font-weight: 600;
		min-width: 8rem;
	}
	.bl-abgesagt {
		margin-top: 0.75rem;
	}
	.bl-abgesagt summary {
		cursor: pointer;
		color: var(--ui-text-leise);
		font-weight: 600;
		padding: 0.7rem 0;
	}
	.bl-abgesagt li {
		color: var(--ui-text-leise);
	}
</style>
