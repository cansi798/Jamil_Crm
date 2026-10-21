<script lang="ts">
	import { tick } from 'svelte';
	import Avatar from './Avatar.svelte';

	/**
	 * DIE Personenauswahl der App (docs/design-regeln.md) – überall, wo eine oder mehrere Personen gewählt oder
	 * gefiltert werden: Chip mit Avatar(en), Liste mit Avataren und Suche (ab 7 Personen), Tastatur (Pfeile, Enter,
	 * Esc). Einzeln (`wert`) oder mehrfach (`mehrfach`, `werte`, Häkchen in der Liste). Die Werte gehen über
	 * versteckte Felder `name` mit dem Formular; `onchange` z. B. für sofortiges Speichern oder Filtern.
	 */
	/** `gruppe`: Überschrift in der Liste (z. B. „Kolonnen“ / „Mitarbeiter“), `farbe`: Punkt statt Avatar-Farbe */
	type Person = { id: string; name: string; gruppe?: string };
	let {
		name,
		personen,
		wert = $bindable(''),
		werte = $bindable([]),
		mehrfach = false,
		label = 'Zuständig',
		leerText = mehrfach ? 'Niemand ausgewählt' : 'Nicht zugewiesen',
		required = false,
		klein = false,
		absenden = false,
		onchange
	}: {
		name: string;
		personen: Person[];
		wert?: string;
		werte?: string[];
		mehrfach?: boolean;
		label?: string;
		leerText?: string;
		/** Pflichtfeld: ohne Auswahl meldet der Browser beim Absenden „Bitte … wählen“ (am Chip). */
		required?: boolean;
		/** schmaler Chip für Filterleisten */
		klein?: boolean;
		/** nach jeder Auswahl das umgebende Formular abschicken (Filter, sofort speichern) */
		absenden?: boolean;
		onchange?: (auswahl: string[]) => void;
	} = $props();

	const id = `pw-${Math.random().toString(36).slice(2, 9)}`;
	let offen = $state(false);
	let aktiv = $state(0);
	let suche = $state('');
	let knopf = $state<HTMLButtonElement>();
	let liste = $state<HTMLElement>();
	let suchfeld = $state<HTMLInputElement>();
	let pflicht = $state<HTMLInputElement>();

	const gewaehlt = $derived(mehrfach ? personen.filter((p) => werte.includes(p.id)) : personen.filter((p) => p.id === wert));
	const mitSuche = $derived(personen.length > 6);
	const gefiltert = $derived.by(() => {
		const q = suche.trim().toLowerCase();
		return q ? personen.filter((p) => p.name.toLowerCase().includes(q)) : personen;
	});
	// Einzeln und nicht Pflicht: „leer“ ist wählbar
	const optionen = $derived<(Person | null)[]>(!mehrfach && !required && !suche.trim() ? [null, ...gefiltert] : gefiltert);
	const anzeige = $derived(
		gewaehlt.length === 0 ? leerText : gewaehlt.length === 1 ? gewaehlt[0].name : `${gewaehlt[0].name} +${gewaehlt.length - 1}`
	);

	$effect(() => {
		pflicht?.setCustomValidity(gewaehlt.length > 0 ? '' : `Bitte ${label} wählen.`);
	});

	async function oeffnen() {
		offen = true;
		suche = '';
		aktiv = 0;
		await tick();
		(mitSuche ? suchfeld : liste)?.focus();
	}
	let wurzel = $state<HTMLDivElement>();
	async function melden() {
		onchange?.(mehrfach ? [...werte] : wert ? [wert] : []);
		if (absenden) {
			await tick();
			wurzel?.closest('form')?.requestSubmit();
		}
	}
	function umschalten(p: Person | null) {
		if (mehrfach) {
			if (!p) return;
			werte = werte.includes(p.id) ? werte.filter((w) => w !== p.id) : [...werte, p.id];
			melden();
		} else {
			wert = p?.id ?? '';
			offen = false;
			knopf?.focus();
			melden();
		}
	}
	function taste(ev: KeyboardEvent) {
		if (ev.key === 'ArrowDown') aktiv = Math.min(optionen.length - 1, aktiv + 1);
		else if (ev.key === 'ArrowUp') aktiv = Math.max(0, aktiv - 1);
		else if (ev.key === 'Enter') {
			if (optionen[aktiv] !== undefined) umschalten(optionen[aktiv]);
		} else if (ev.key === 'Escape') {
			offen = false;
			knopf?.focus();
		} else return;
		ev.preventDefault();
		liste?.querySelector(`#${id}-${aktiv}`)?.scrollIntoView({ block: 'nearest' });
	}
	function draussen(ev: FocusEvent) {
		const ziel = ev.relatedTarget as Node | null;
		if (!ziel || !(ev.currentTarget as HTMLElement).contains(ziel)) offen = false;
	}
</script>

<div class="pw" class:klein bind:this={wurzel} onfocusout={draussen} onkeydown={offen ? taste : undefined} role="presentation">
	{#if mehrfach}
		{#each werte as w (w)}<input type="hidden" {name} value={w} />{/each}
	{:else if !required}
		<input type="hidden" {name} value={wert} />
	{/if}
	{#if required}
		<!-- Unsichtbares Pflichtfeld: trägt (einzeln) den Wert und lässt den Browser bei leerer Auswahl warnen -->
		<input class="pw-pflicht" type="text" name={mehrfach ? undefined : name} value={mehrfach ? werte.join(',') : wert} required tabindex="-1" aria-hidden="true" bind:this={pflicht} />
	{/if}
	<button
		bind:this={knopf}
		type="button"
		class="ui-chip"
		class:gesetzt={gewaehlt.length > 0}
		aria-haspopup={mehrfach ? 'dialog' : 'listbox'}
		aria-expanded={offen}
		aria-label={`${label}${required ? ' (Pflichtfeld)' : ''}: ${gewaehlt.length ? gewaehlt.map((p) => p.name).join(', ') : leerText}`}
		onclick={() => (offen ? (offen = false) : oeffnen())}
	>
		{#if gewaehlt.length > 1}
			<span class="pw-stapel" aria-hidden="true">
				{#each gewaehlt.slice(0, 3) as p (p.id)}<Avatar name={p.name} groesse={22} />{/each}
			</span>
		{:else}
			<Avatar name={gewaehlt[0]?.name ?? ''} groesse={22} />
		{/if}
		<span class="pw-text">{anzeige}</span>
		<svg class="pw-pfeil" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
	{#if offen}
		<div class="ui-popover pw-feld" role={mehrfach ? 'dialog' : undefined} aria-label={mehrfach ? label : undefined}>
			{#if mitSuche}
				<div class="pw-suche">
					<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
					<input bind:this={suchfeld} type="search" bind:value={suche} placeholder="Person suchen …" aria-label={`${label}: suchen`} autocomplete="off" oninput={() => (aktiv = 0)} />
				</div>
			{/if}
			{#if mehrfach}
				<div class="pw-liste" bind:this={liste} tabindex="-1">
					{#each optionen as p, i (p?.id ?? '')}
						{#if p?.gruppe && p.gruppe !== optionen[i - 1]?.gruppe}<p class="pw-gruppe">{p.gruppe}</p>{/if}
						{#if p}
							<label id={`${id}-${i}`} class="pw-zeile" class:aktiv={i === aktiv} onmousemove={() => (aktiv = i)}>
								<input type="checkbox" checked={werte.includes(p.id)} onchange={() => umschalten(p)} />
								<Avatar name={p.name} groesse={26} />
								<span>{p.name}</span>
							</label>
						{/if}
					{:else}
						<p class="pw-nichts">Niemand gefunden.</p>
					{/each}
				</div>
				<div class="pw-fuss">
					<span class="kd-info">{werte.length} ausgewählt</span>
					<button type="button" class="kd-knopf klein" onclick={() => { offen = false; knopf?.focus(); }}>Fertig</button>
				</div>
			{:else}
				<ul class="pw-liste" bind:this={liste} role="listbox" tabindex="-1" aria-label={label} aria-activedescendant={`${id}-${aktiv}`}>
					{#each optionen as p, i (p?.id ?? '')}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<li
							id={`${id}-${i}`}
							role="option"
							class="pw-zeile"
							aria-selected={(p?.id ?? '') === wert}
							class:aktiv={i === aktiv}
							onmousemove={() => (aktiv = i)}
							onmousedown={(ev) => ev.preventDefault()}
							onclick={() => umschalten(p)}
						>
							<Avatar name={p?.name ?? ''} groesse={26} />
							<span class:leise={!p}>{p?.name ?? leerText}</span>
							{#if (p?.id ?? '') === wert}<svg class="pw-haken" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
						</li>
					{:else}
						<li class="pw-nichts" role="presentation">Niemand gefunden.</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.pw {
		position: relative;
		display: inline-block;
		max-width: 100%;
	}
	.pw-pflicht {
		position: absolute;
		left: 1rem;
		bottom: 0;
		width: 1px !important;
		height: 1px !important;
		min-height: 0 !important;
		padding: 0 !important;
		border: 0 !important;
		opacity: 0;
		pointer-events: none;
	}
	.klein .ui-chip {
		min-height: 2.25rem;
	}
	.pw-stapel {
		display: inline-flex;
	}
	.pw-stapel :global(.avatar + .avatar) {
		margin-left: -7px;
		box-shadow: 0 0 0 2px var(--ui-flaeche);
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
	.pw-feld {
		position: absolute;
		z-index: 30;
		top: calc(100% + 4px);
		left: 0;
		width: min(18rem, calc(100vw - 2rem));
		padding: 0.3rem;
	}
	.pw-suche {
		position: relative;
		margin: 0.1rem 0.1rem 0.35rem;
	}
	.pw-suche svg {
		position: absolute;
		left: 0.7rem;
		top: 50%;
		width: 14px;
		height: 14px;
		margin-top: -7px;
		color: var(--ui-text-leise);
	}
	.pw-suche input {
		width: 100%;
		min-height: 2.25rem !important;
		padding-left: 2rem !important;
		border-radius: 999px !important;
	}
	.pw-liste {
		max-height: 17rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pw-liste:focus {
		outline: none;
	}
	.pw-zeile {
		display: flex !important;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.5rem;
		padding: 0.3rem 0.6rem;
		border-radius: 8px;
		color: var(--ui-text) !important;
		font-size: var(--ui-schrift-m) !important;
		font-weight: 500 !important;
		cursor: pointer;
	}
	.pw-zeile.aktiv {
		background: var(--ui-akzent-zart);
	}
	.pw-zeile[aria-selected='true'],
	.pw-zeile:has(input:checked) {
		background: var(--ui-akzent-hell);
		font-weight: 600 !important;
	}
	.leise {
		color: var(--ui-text-leise);
	}
	.pw-haken {
		width: 16px;
		height: 16px;
		margin-left: auto;
		color: var(--ui-akzent-text);
	}
	.pw-gruppe {
		margin: 0.35rem 0.6rem 0.15rem;
		color: var(--ui-akzent-text);
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.pw-nichts {
		margin: 0;
		padding: 0.75rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-m);
	}
	.pw-fuss {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.3rem;
		padding: 0.4rem 0.3rem 0.1rem;
		border-top: 1px solid var(--ui-rand);
	}
</style>
