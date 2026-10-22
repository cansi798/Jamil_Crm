<script lang="ts">
	/**
	 * Status-Menü eines Auftrags (Wunsch Jamil, msg 3112): „Status ▾“ öffnet eine schwebende Liste ALLER Status
	 * untereinander, jeweils mit Farbpunkt; der aktuelle hat einen Haken. Wählbar sind nur die Wechsel, die der Server
	 * hier erlaubt (`erlaubt`); die anderen stehen ausgegraut mit kurzem Grund. Die Liste liegt obenauf (Popover) –
	 * die Karte verzieht sich nicht. Tastatur: Pfeile, Pos1/Ende, Enter/Leertaste, Esc; Screenreader: menu/menuitemradio.
	 */
	import { tick } from 'svelte';
	import { STATUS, STATUS_NAMEN, type AuftragStatus } from '$lib/auftrag-status';
	import { STATUS_FARBEN } from '$lib/auftrag-board';
	import { overlayLage, overlayStil, zeigeOverlay, type OverlayLage } from '$lib/overlay';

	let {
		status,
		titel,
		erlaubt,
		grund,
		gesperrt = false,
		onwaehle
	}: {
		status: AuftragStatus;
		/** Name des Auftrags (für die Beschriftung) */
		titel: string;
		erlaubt: (nach: AuftragStatus) => boolean;
		/** kurzer Grund für ausgegraute Einträge */
		grund: (nach: AuftragStatus) => string;
		gesperrt?: boolean;
		onwaehle: (nach: AuftragStatus) => void;
	} = $props();

	const id = `sm-${Math.random().toString(36).slice(2, 9)}`;
	let knopf = $state<HTMLButtonElement>();
	let liste = $state<HTMLUListElement>();
	let offen = $state(false);
	let aktiv = $state(0);
	let lage = $state<OverlayLage | null>(null);

	async function oeffnen() {
		if (gesperrt) return;
		offen = true;
		aktiv = Math.max(0, STATUS.indexOf(status));
		await tick();
		zeigeOverlay(liste);
		if (knopf && liste) lage = overlayLage(knopf.getBoundingClientRect(), liste.scrollHeight, { minBreite: 208, rechtsBuendig: true });
		await tick();
		liste?.querySelector<HTMLElement>(`#${id}-${aktiv}`)?.focus();
	}
	function schliessen(fokus = true) {
		offen = false;
		lage = null;
		if (fokus) knopf?.focus();
	}
	function waehle(nach: AuftragStatus) {
		if (nach === status || !erlaubt(nach)) return;
		schliessen();
		onwaehle(nach);
	}
	function taste(ev: KeyboardEvent) {
		const n = STATUS.length;
		if (ev.key === 'ArrowDown') aktiv = (aktiv + 1) % n;
		else if (ev.key === 'ArrowUp') aktiv = (aktiv - 1 + n) % n;
		else if (ev.key === 'Home') aktiv = 0;
		else if (ev.key === 'End') aktiv = n - 1;
		else if (ev.key === 'Enter' || ev.key === ' ') waehle(STATUS[aktiv]);
		else if (ev.key === 'Escape') schliessen();
		else if (ev.key === 'Tab') schliessen(false);
		else return;
		ev.preventDefault();
		liste?.querySelector<HTMLElement>(`#${id}-${aktiv}`)?.focus();
	}
	function draussen(ev: FocusEvent) {
		const ziel = ev.relatedTarget as Node | null;
		if (!ziel || !(ev.currentTarget as HTMLElement).contains(ziel)) schliessen(false);
	}
	// Scrollen außerhalb oder Größenänderung schließen (sonst rutscht das Menü vom Knopf weg)
	$effect(() => {
		if (!offen) return;
		const zu = (ev: Event) => {
			if (ev.type === 'scroll' && liste && ev.target instanceof Node && liste.contains(ev.target)) return;
			schliessen(false);
		};
		window.addEventListener('scroll', zu, true);
		window.addEventListener('resize', zu);
		return () => {
			window.removeEventListener('scroll', zu, true);
			window.removeEventListener('resize', zu);
		};
	});
</script>

<span class="sm" onfocusout={draussen}>
	<button
		bind:this={knopf}
		type="button"
		class="sm-knopf"
		aria-haspopup="menu"
		aria-expanded={offen}
		aria-controls={offen ? id : undefined}
		aria-label={`Status von „${titel}“ ändern (jetzt: ${STATUS_NAMEN[status]})`}
		disabled={gesperrt}
		draggable="false"
		onpointerdown={(ev) => ev.stopPropagation()}
		onclick={() => (offen ? schliessen() : oeffnen())}
		onkeydown={(ev) => {
			if (ev.key === 'ArrowDown' && !offen) {
				ev.preventDefault();
				oeffnen();
			}
		}}>Status ▾</button
	>
	{#if offen}
		<ul
			bind:this={liste}
			{id}
			class="ui-popover sm-liste"
			popover="manual"
			role="menu"
			aria-label={`Status von „${titel}“`}
			tabindex="-1"
			onkeydown={taste}
			onpointerdown={(ev) => ev.stopPropagation()}
			style={lage ? overlayStil(lage) : 'visibility:hidden'}
		>
			{#each STATUS as s, i (s)}
				{@const aktuell = s === status}
				{@const ok = aktuell || erlaubt(s)}
				<li role="none">
					<button
						type="button"
						id={`${id}-${i}`}
						role="menuitemradio"
						aria-checked={aktuell}
						aria-disabled={!ok || aktuell || undefined}
						class:aus={!ok}
						class:aktuell
						tabindex={i === aktiv ? 0 : -1}
						title={ok ? (aktuell ? 'aktueller Status' : `Status auf „${STATUS_NAMEN[s]}“ setzen`) : grund(s)}
						onmousemove={() => (aktiv = i)}
						onclick={() => waehle(s)}
					>
						<span class="sm-punkt" style:background={STATUS_FARBEN[s]} aria-hidden="true"></span>
						<span class="sm-name">{STATUS_NAMEN[s]}</span>
						{#if aktuell}
							<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
						{:else if !ok}
							<span class="sm-grund">{grund(s)}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</span>

<style>
	.sm {
		position: relative;
		display: inline-flex;
	}
	.sm-knopf {
		display: inline-flex;
		align-items: center;
		min-height: 2rem;
		padding: 0 0.5rem;
		border: 0;
		border-radius: var(--m365-radius);
		background: transparent;
		color: var(--ui-akzent-text);
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.sm-knopf:hover,
	.sm-knopf[aria-expanded='true'] {
		background: var(--m365-flaeche-hover);
	}
	.sm-knopf:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.sm-liste {
		position: fixed;
		z-index: 1000;
		inset: auto;
		margin: 0;
		padding: 0.3rem;
		list-style: none;
		overflow-y: auto;
		overscroll-behavior: contain;
		color: var(--ui-text);
	}
	.sm-liste button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		min-height: var(--tippziel, 44px);
		padding: 0 0.7rem;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}
	.sm-liste button:hover:not(.aus):not(.aktuell),
	.sm-liste button:focus-visible {
		outline: none;
		background: var(--ui-akzent-zart);
	}
	.sm-liste button.aktuell {
		font-weight: 700;
		cursor: default;
	}
	.sm-liste button.aus {
		color: var(--ui-text-leise);
		cursor: not-allowed;
	}
	.sm-liste button.aus .sm-punkt {
		opacity: 0.4;
	}
	.sm-punkt {
		flex: none;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
	}
	.sm-name {
		flex: 1;
	}
	.sm-grund {
		font-size: 0.6875rem;
	}
	.sm-liste svg {
		flex: none;
		width: 1rem;
		height: 1rem;
		color: var(--ui-akzent-text);
	}
</style>
