<script lang="ts">
	import { tick } from 'svelte';
	import Avatar from './Avatar.svelte';

	/**
	 * Auswahl einer Person als Chip mit Avatar (statt nativer <select>): „Nicht zugewiesen“ oder Avatar + Name.
	 * Klick öffnet eine Liste mit Avataren (Tastatur: Pfeile, Enter, Esc). Der Wert geht über ein verstecktes
	 * Feld `name` mit dem Formular.
	 */
	let {
		name,
		personen,
		wert = $bindable(''),
		label = 'Zuständig',
		leerText = 'Nicht zugewiesen'
	}: {
		name: string;
		personen: { id: string; name: string }[];
		wert?: string;
		label?: string;
		leerText?: string;
	} = $props();

	const id = `pw-${Math.random().toString(36).slice(2, 9)}`;
	let offen = $state(false);
	let aktiv = $state(0);
	let knopf = $state<HTMLButtonElement>();
	let liste = $state<HTMLUListElement>();
	const optionen = $derived([{ id: '', name: leerText }, ...personen]);
	const gewaehlt = $derived(personen.find((p) => p.id === wert) ?? null);

	async function oeffnen() {
		offen = true;
		aktiv = Math.max(0, optionen.findIndex((o) => o.id === wert));
		await tick();
		liste?.focus();
	}
	function waehle(i: number) {
		wert = optionen[i].id;
		offen = false;
		knopf?.focus();
	}
	function taste(ev: KeyboardEvent) {
		if (ev.key === 'ArrowDown') aktiv = Math.min(optionen.length - 1, aktiv + 1);
		else if (ev.key === 'ArrowUp') aktiv = Math.max(0, aktiv - 1);
		else if (ev.key === 'Home') aktiv = 0;
		else if (ev.key === 'End') aktiv = optionen.length - 1;
		else if (ev.key === 'Enter' || ev.key === ' ') waehle(aktiv);
		else if (ev.key === 'Escape' || ev.key === 'Tab') {
			offen = false;
			if (ev.key === 'Escape') knopf?.focus();
			return;
		} else return;
		ev.preventDefault();
		liste?.querySelector(`#${id}-${aktiv}`)?.scrollIntoView({ block: 'nearest' });
	}
	function draussen(ev: FocusEvent) {
		const ziel = ev.relatedTarget as Node | null;
		if (!ziel || !(ev.currentTarget as HTMLElement).contains(ziel)) offen = false;
	}
</script>

<div class="pw" onfocusout={draussen}>
	<input type="hidden" {name} value={wert} />
	<button
		bind:this={knopf}
		type="button"
		class="ui-chip"
		class:gesetzt={!!gewaehlt}
		aria-haspopup="listbox"
		aria-expanded={offen}
		aria-label={`${label}: ${gewaehlt ? gewaehlt.name : leerText}`}
		onclick={() => (offen ? (offen = false) : oeffnen())}
	>
		<Avatar name={gewaehlt?.name ?? ''} groesse={22} />
		<span class="pw-text">{gewaehlt ? gewaehlt.name : leerText}</span>
		<svg class="pw-pfeil" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
	{#if offen}
		<ul
			bind:this={liste}
			class="ui-popover pw-liste"
			role="listbox"
			tabindex="-1"
			aria-label={label}
			aria-activedescendant={`${id}-${aktiv}`}
			onkeydown={taste}
		>
			{#each optionen as o, i (o.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={`${id}-${i}`}
					role="option"
					aria-selected={o.id === wert}
					class:aktiv={i === aktiv}
					onmousemove={() => (aktiv = i)}
					onclick={() => waehle(i)}
				>
					<Avatar name={o.id ? o.name : ''} groesse={24} />
					<span>{o.name}</span>
					{#if o.id === wert}<svg class="pw-haken" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.pw {
		position: relative;
		display: inline-block;
		max-width: 100%;
	}
	.pw-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ui-chip:not(.gesetzt) .pw-text {
		color: var(--ui-text-leise);
	}
	.pw-pfeil {
		width: 14px;
		height: 14px;
		flex: none;
		color: var(--ui-text-leise);
	}
	.pw-liste {
		position: absolute;
		z-index: 30;
		top: calc(100% + 4px);
		left: 0;
		min-width: 15rem;
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
	}
	.pw-liste li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.5rem;
		padding: 0.3rem 0.6rem;
		border-radius: 8px;
		font-size: var(--ui-schrift-m);
		cursor: pointer;
	}
	.pw-liste li.aktiv {
		background: var(--m365-flaeche-hover);
	}
	.pw-liste li[aria-selected='true'] {
		font-weight: 600;
	}
	.pw-haken {
		width: 16px;
		height: 16px;
		margin-left: auto;
		color: var(--ui-akzent);
	}
</style>
