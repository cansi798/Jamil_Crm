<script lang="ts">
	import { schwebend } from '$lib/overlay';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { istFarbe, schriftAuf } from '$lib/farben';

	/**
	 * Auftragsquelle als farbiger Chip im Auftragskopf (Jamil msg 2844): Klick öffnet die Liste der Quellen, die Wahl
	 * wird sofort gespeichert (`aktion`, Feld `quelleId`). Ohne Recht nur das Etikett.
	 */
	type Quelle = { id: string; name: string; aktiv: boolean; farbe: string | null };
	let {
		quellen,
		wert,
		name = null,
		farbe = null,
		darf = false,
		aktion = '?/aendern',
		absenden
	}: {
		quellen: Quelle[];
		wert: string | null;
		/** Name/Farbe der gesetzten Quelle (auch wenn sie inzwischen inaktiv ist) */
		name?: string | null;
		farbe?: string | null;
		darf?: boolean;
		aktion?: string;
		/** use:enhance-Funktion der Seite (z. B. „Gespeichert“ zeigen) */
		absenden?: SubmitFunction;
	} = $props();

	let offen = $state(false);
	let gewaehlt = $state<string>('');
	let formEl = $state<HTMLFormElement>();
	let knopf = $state<HTMLButtonElement>();
	const hinten = $derived(istFarbe(farbe) ? farbe : null);
	const liste = $derived(quellen.filter((q) => q.aktiv || q.id === wert));

	async function waehle(id: string) {
		gewaehlt = id;
		offen = false;
		await tick();
		formEl?.requestSubmit();
		knopf?.focus();
	}
</script>

{#if darf}
	<div class="qc" onfocusout={(ev) => { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) offen = false; }}>
		<form bind:this={formEl} method="POST" action={aktion} use:enhance={absenden}>
			<input type="hidden" name="quelleId" value={gewaehlt} />
		</form>
		<button
			bind:this={knopf}
			type="button"
			class="qc-chip"
			class:leer={!name}
			style:background-color={hinten}
			style:color={hinten ? schriftAuf(hinten) : null}
			aria-haspopup="listbox"
			aria-expanded={offen}
			aria-label={`Auftragsquelle: ${name ?? 'keine'} – ändern`}
			onclick={() => (offen = !offen)}
		>
			{name ?? '+ Auftragsquelle'}
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
		</button>
		{#if offen}
			<ul class="ui-popover qc-liste" role="listbox" aria-label="Auftragsquelle wählen" use:schwebend={{ anker: () => knopf, onschliessen: () => (offen = false), minBreite: 208 }}>
				{#each liste as q (q.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li role="option" aria-selected={q.id === wert} tabindex="0" onclick={() => waehle(q.id)} onkeydown={(e) => e.key === 'Enter' && waehle(q.id)}>
						<span class="qc-punkt" style:background-color={istFarbe(q.farbe) ? q.farbe : '#8a8886'}></span>{q.name}
					</li>
				{/each}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li role="option" aria-selected={!wert} tabindex="0" class="qc-keine" onclick={() => waehle('')} onkeydown={(e) => e.key === 'Enter' && waehle('')}>Keine Quelle</li>
			</ul>
		{/if}
	</div>
{:else if name}
	<span class="qc-chip statisch" style:background-color={hinten} style:color={hinten ? schriftAuf(hinten) : null}>{name}</span>
{/if}

<style>
	.qc {
		position: relative;
		display: inline-block;
	}
	.qc form {
		display: none;
	}
	.qc-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 1.75rem;
		padding: 0 0.7rem;
		border: 0;
		border-radius: 999px;
		background: var(--ui-grau);
		color: #fff;
		font-family: var(--ui-schrift-titel);
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		transition: filter 120ms, box-shadow 120ms;
	}
	.qc-chip:hover {
		filter: brightness(0.95);
		box-shadow: 0 0 0 3px var(--ui-akzent-hell);
	}
	.qc-chip:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.qc-chip.leer {
		border: 1.5px dashed var(--ui-rand-stark);
		background: var(--ui-flaeche);
		color: var(--ui-text-leise);
	}
	.qc-chip.statisch {
		cursor: default;
	}
	.qc-chip svg {
		width: 12px;
		height: 12px;
	}
	/* schwebt obenauf (use:schwebend, Regel msg 3116) */
	.qc-liste {
		min-width: 13rem;
		margin: 0;
		padding: 0.3rem;
		list-style: none;
	}
	.qc-liste li {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 2.375rem;
		padding: 0.3rem 0.65rem;
		border-radius: 8px;
		font-size: var(--ui-schrift-m);
		cursor: pointer;
	}
	.qc-liste li:hover,
	.qc-liste li:focus-visible {
		background: var(--ui-akzent-zart);
		outline: none;
	}
	.qc-liste li[aria-selected='true'] {
		font-weight: 600;
		background: var(--ui-akzent-hell);
	}
	.qc-punkt {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
	}
	.qc-keine {
		color: var(--ui-text-leise);
	}
</style>
