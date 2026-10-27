<script lang="ts">
	/**
	 * Info-Fenster ⓘ (Jamil, Talk msg 3423): kleines Fragezeichen-Symbol neben einer Einstellung; ein Tipp oder Klick
	 * öffnet ein schwebendes Fenster, das erklärt, was die Einstellung verändert (wirkt auf wen, Standard, Beispiel).
	 * Texte stehen zentral in `$lib/einstellungs-infos.ts`. Tastatur: Enter/Leertaste öffnet, Esc schließt und gibt den
	 * Fokus zurück; Klick außerhalb schließt. Tippfläche mindestens 44 px. Das Fenster schwebt (`$lib/overlay`).
	 */
	import { schwebend } from '$lib/overlay';
	import { infoFuer } from '$lib/einstellungs-infos';

	let { id }: { id: string } = $props();
	const info = $derived(infoFuer(id));
	const dom = `info-${Math.random().toString(36).slice(2, 9)}`;
	let offen = $state(false);
	let knopf = $state<HTMLButtonElement>();
	let fenster = $state<HTMLDivElement>();

	function zu(fokus = false) {
		offen = false;
		if (fokus) knopf?.focus();
	}
	function aussen(ev: PointerEvent) {
		if (!offen) return;
		const z = ev.target;
		if (z instanceof Node && !knopf?.contains(z) && !fenster?.contains(z)) zu();
	}
	function taste(ev: KeyboardEvent) {
		if (ev.key === 'Escape' && offen) {
			ev.stopPropagation();
			zu(true);
		}
	}
</script>

<svelte:window onpointerdown={aussen} onkeydown={taste} />

{#if info}
	<span class="inf">
		<button
			type="button"
			class="inf-knopf"
			bind:this={knopf}
			aria-expanded={offen}
			aria-controls={offen ? dom : undefined}
			aria-label={`Was bewirkt diese Einstellung? ${info.titel}`}
			onclick={() => (offen = !offen)}
			data-testid="info-knopf"
		>
			<span class="inf-zeichen" aria-hidden="true">i</span>
		</button>
		{#if offen}
			<div
				class="inf-fenster ui-popover"
				id={dom}
				role="note"
				aria-label={info.titel}
				bind:this={fenster}
				data-testid="info-fenster"
				use:schwebend={{ anker: () => knopf, onschliessen: () => (offen = false), breite: 'eigen', maxHoehe: 420 }}
			>
				<strong class="inf-titel">{info.titel}</strong>
				<dl>
					<dt>Was sie verändert</dt>
					<dd>{info.was}</dd>
					<dt>Wirkt auf</dt>
					<dd>{info.wirkt}</dd>
					<dt>Standard</dt>
					<dd>{info.standard}</dd>
					<dt>Beispiel</dt>
					<dd>{info.beispiel}</dd>
				</dl>
				<button type="button" class="kd-knopf hell klein" onclick={() => zu(true)}>Schließen</button>
			</div>
		{/if}
	</span>
{/if}

<style>
	/* Platzbedarf = nur das Symbol (verändert keine Zeilenhöhe); die Tippfläche von 44 px liegt mittig darüber */
	.inf {
		position: relative;
		display: inline-flex;
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		margin-inline-start: 0.3rem;
		vertical-align: middle;
	}
	.inf-knopf {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		transform: translate(-50%, -50%);
		cursor: pointer;
	}
	.inf-zeichen {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 1.5px solid var(--ui-text-leise);
		border-radius: 999px;
		color: var(--ui-text-leise);
		font: 700 0.75rem/1 var(--ui-schrift-titel, inherit);
		text-transform: none;
		letter-spacing: 0;
	}
	.inf-knopf:hover .inf-zeichen,
	.inf-knopf[aria-expanded='true'] .inf-zeichen {
		border-color: var(--ui-akzent-text);
		color: var(--ui-akzent-text);
	}
	.inf-knopf:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
		border-radius: 999px;
	}
	.inf-fenster {
		display: grid;
		gap: 0.5rem;
		width: min(24rem, calc(100vw - 16px));
		padding: 0.9rem 1rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		box-shadow: var(--ui-schatten-popover, 0 8px 24px rgba(0, 0, 0, 0.18));
		font-size: var(--ui-schrift-s);
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		line-height: 1.55;
		text-align: left;
	}
	.inf-titel {
		font-family: var(--ui-schrift-titel);
		font-size: var(--ui-schrift-m);
	}
	dl {
		display: grid;
		gap: 0.15rem;
		margin: 0;
	}
	dt {
		margin-top: 0.35rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	dd {
		margin: 0;
	}
	.inf-fenster :global(.kd-knopf) {
		justify-self: end;
	}
</style>
