<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';

	/**
	 * Eingeklapptes „Hinzufügen“-Formular (Wunsch Jamil msgs 2579–2583: „Nichts standardmäßig ausgeklappt“).
	 * Zeigt nur einen Knopf („+ To-do hinzufügen“); Klick klappt das Formular inline auf, der erste Eingabe-
	 * bereich bekommt den Fokus. Zu geht es mit „Abbrechen“ (Snippet-Argument `schliessen`), mit Esc – und von
	 * selbst nach erfolgreichem Speichern: Nach einem Absenden im Feld wartet das Feld auf die nächste
	 * Antwort der Seite (neue Daten oder neues `form`). Enthält `form` einen Fehler (Schlüssel mit „fehler“),
	 * bleibt das Feld offen, damit die Eingaben stehen bleiben.
	 *
	 * Beispiel:
	 *   <AddPanel label="Notiz hinzufügen">
	 *     {#snippet children(schliessen)}
	 *       <form …> … <button class="kd-knopf">Speichern</button>
	 *         <button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button></form>
	 *     {/snippet}
	 *   </AddPanel>
	 */
	let {
		label,
		offen = $bindable(false),
		art = 'sekundaer',
		voll = false,
		children
	}: {
		label: string;
		/** von außen öffnen (z. B. bei einem Fehler aus dem Server) oder lesen */
		offen?: boolean;
		/** Knopf-Art des Auslösers */
		art?: 'primaer' | 'sekundaer';
		/** Auslöser auf ganzer Breite (mobil-freundlich) */
		voll?: boolean;
		children: Snippet<[() => void]>;
	} = $props();

	const id = `addpanel-${Math.random().toString(36).slice(2, 9)}`;
	let feld = $state<HTMLDivElement>();
	let ausloeser = $state<HTMLButtonElement>();
	let wartet = $state(false);

	async function oeffnen() {
		offen = true;
		await tick();
		feld?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus();
	}
	async function schliessen() {
		offen = false;
		wartet = false;
		await tick();
		ausloeser?.focus();
	}
	function taste(ev: KeyboardEvent) {
		if (ev.key === 'Escape') {
			ev.stopPropagation();
			schliessen();
		}
	}

	// Nach dem Absenden: auf die Antwort der Seite warten, dann (ohne Fehler) zuklappen.
	let stand = { data: page.data, form: page.form };
	$effect(() => {
		const data = page.data;
		const form = page.form;
		untrack(() => {
			const geaendert = data !== stand.data || form !== stand.form;
			stand = { data, form };
			if (!wartet || !geaendert) return;
			wartet = false;
			const fehler = form && typeof form === 'object' && Object.keys(form).some((k) => /fehler/i.test(k) && (form as Record<string, unknown>)[k]);
			if (!fehler) offen = false;
		});
	});
</script>

<div class="add-panel" class:offen>
	{#if !offen}
		<button
			bind:this={ausloeser}
			type="button"
			class={art === 'primaer' ? 'kd-knopf' : 'kd-knopf hell'}
			class:voll
			aria-expanded="false"
			aria-controls={id}
			onclick={oeffnen}
		>
			<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
			{label}
		</button>
	{:else}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={feld}
			{id}
			class="add-panel-feld"
			role="region"
			aria-label={label}
			onkeydown={taste}
			onsubmit={() => (wartet = true)}
		>
			<div class="add-panel-kopf">
				<span class="add-panel-titel">{label}</span>
				<button type="button" class="add-panel-zu" aria-label="Schließen" onclick={schliessen}>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
				</button>
			</div>
			{@render children(schliessen)}
		</div>
	{/if}
</div>

<style>
	.add-panel {
		margin: 0.5rem 0 1rem;
	}
	.voll {
		width: 100%;
	}
	.add-panel-feld {
		padding: 0.75rem 1rem 1rem;
		border: 1px solid #cfe0f3;
		border-radius: var(--ui-radius-karte, 10px);
		background: var(--ui-akzent-zart, #f5f9fd);
	}
	.add-panel-kopf {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.add-panel-titel {
		font-weight: 600;
		font-size: 0.9375rem;
	}
	.add-panel-zu {
		display: inline-grid;
		place-items: center;
		width: var(--tippziel, 44px);
		height: var(--tippziel, 44px);
		margin: -0.5rem -0.5rem -0.5rem 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--ui-text-leise, #59636e);
		cursor: pointer;
	}
	.add-panel-zu:hover {
		background: var(--ui-akzent-hell, #ebf3fc);
		color: var(--ui-akzent, #0f6cbd);
	}
	.add-panel-zu svg {
		width: 1rem;
		height: 1rem;
	}
</style>
