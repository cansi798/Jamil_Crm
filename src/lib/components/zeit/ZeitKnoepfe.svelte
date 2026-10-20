<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { laufzeitText, ZEIT_ART_NAMEN, type StempelAktion, type ZeitEintrag } from '$lib/zeiterfassung';

	/**
	 * Große Knöpfe der Zeiterfassung (mobil zuerst, ein Tipp): Start / Pause / Weiter / Fertig, Abfahrt / Angekommen.
	 * Immer für einen Auftrag (jede Zeit gehört zu einem Auftrag, Jamil msg 2790).
	 * Startet man hier, während woanders etwas läuft, wird das automatisch beendet (je Person läuft immer nur eines).
	 */
	let {
		auftragId,
		titel = '',
		laufend,
		kompakt = false
	}: {
		auftragId: string;
		/** z. B. „A-2026-0003 Badsanierung“ – für Meldungen und Screenreader */
		titel?: string;
		laufend: ZeitEintrag | null;
		kompakt?: boolean;
	} = $props();

	let fehler = $state('');
	let meldung = $state('');
	let laeuft = $state(false);
	let jetzt = $state(new Date());
	const uhr = setInterval(() => (jetzt = new Date()), 15_000);
	onDestroy(() => clearInterval(uhr));

	const hier = $derived(!!laufend && laufend.auftragId === auftragId);
	const woanders = $derived(!!laufend && !hier);
	const wasLaeuftWoanders = $derived(
		laufend ? `${ZEIT_ART_NAMEN[laufend.art]} · ${laufend.auftragNummer ?? ''} ${laufend.auftragTitel ?? ''}`.trim() : ''
	);

	async function tippe(aktion: StempelAktion) {
		if (laeuft) return;
		fehler = '';
		meldung = '';
		laeuft = true;
		try {
			const r = await fetch('/api/zeiten/stempeln', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ aktion, auftragId })
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) fehler = j.fehler ?? 'Das hat nicht geklappt – bitte noch einmal.';
			else {
				meldung = j.meldung ?? '';
				await invalidateAll();
			}
		} catch {
			fehler = 'Keine Verbindung – bitte noch einmal tippen.';
		} finally {
			laeuft = false;
		}
	}
</script>

<div class="zk" class:kompakt aria-busy={laeuft}>
	{#if hier && laufend}
		<p class="zk-status" class:pause={laufend.art === 'pause'} class:fahrt={laufend.art === 'fahrt'}>
			<span class="zk-punkt" aria-hidden="true"></span>
			<span><strong>{ZEIT_ART_NAMEN[laufend.art]} läuft</strong> · {laufzeitText(laufend.beginn, jetzt)}</span>
		</p>
		<div class="zk-knoepfe">
			{#if laufend.art === 'arbeit'}
				<button type="button" class="zk-knopf pause" disabled={laeuft} onclick={() => tippe('pause')}>Pause</button>
				<button type="button" class="zk-knopf stopp" disabled={laeuft} onclick={() => tippe('fertig')}>Fertig</button>
			{:else if laufend.art === 'pause'}
				<button type="button" class="zk-knopf start" disabled={laeuft} onclick={() => tippe('weiter')}>Weiter</button>
				<button type="button" class="zk-knopf stopp" disabled={laeuft} onclick={() => tippe('fertig')}>Fertig</button>
			{:else}
				<button type="button" class="zk-knopf start" disabled={laeuft} onclick={() => tippe('angekommen')}>Angekommen</button>
				<button type="button" class="zk-knopf leise" disabled={laeuft} onclick={() => tippe('fertig')}>Fahrt beenden</button>
			{/if}
		</div>
	{:else}
		{#if woanders}
			<p class="zk-hinweis">Läuft gerade: {wasLaeuftWoanders} – ein Start hier beendet das.</p>
		{/if}
		<div class="zk-knoepfe">
			<button type="button" class="zk-knopf start" disabled={laeuft} onclick={() => tippe('start')} aria-label={`Arbeitszeit starten${titel ? ` – ${titel}` : ''}`}>Start</button>
			<button type="button" class="zk-knopf fahrt" disabled={laeuft} onclick={() => tippe('abfahrt')} aria-label={`Abfahrt${titel ? ` zu ${titel}` : ''}`}>Abfahrt</button>
		</div>
	{/if}
	<p class="zk-meldung" role="status" aria-live="polite">{#if fehler}<span class="fehler">{fehler}</span>{:else}{meldung}{/if}</p>
</div>

<style>
	.zk {
		display: grid;
		gap: var(--ui-a2);
	}
	.zk-knoepfe {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: var(--ui-a2);
	}
	.zk-knopf {
		min-height: 3.5rem;
		border: 0;
		border-radius: var(--ui-knopf-radius);
		font: inherit;
		font-size: var(--ui-schrift-l);
		font-weight: 700;
		color: #fff;
		cursor: pointer;
		box-shadow: var(--ui-schatten);
	}
	.kompakt .zk-knopf {
		min-height: 3rem;
	}
	.zk-knopf:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.zk-knopf:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.start {
		background: var(--ui-gruen);
	}
	.pause {
		background: var(--ui-orange);
	}
	.stopp {
		background: var(--ui-rot);
	}
	.fahrt {
		background: var(--ui-blau);
	}
	.leise {
		background: var(--ui-flaeche);
		color: var(--ui-text);
		border: 1px solid var(--ui-rand-stark);
	}
	.zk-status {
		display: flex;
		align-items: center;
		gap: var(--ui-a2);
		margin: 0;
		padding: var(--ui-a2) var(--ui-a3);
		border-radius: var(--ui-radius);
		background: var(--ui-gruen-hell);
		font-size: var(--ui-schrift-m);
	}
	.zk-status.pause {
		background: var(--ui-orange-hell);
	}
	.zk-status.fahrt {
		background: var(--ui-blau-hell);
	}
	.zk-punkt {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--ui-gruen);
		animation: puls 1.6s ease-in-out infinite;
	}
	.pause .zk-punkt {
		background: var(--ui-orange);
	}
	.fahrt .zk-punkt {
		background: var(--ui-blau);
	}
	@keyframes puls {
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.zk-punkt {
			animation: none;
		}
	}
	.zk-hinweis {
		margin: 0;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.zk-meldung {
		margin: 0;
		min-height: 1.2em;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.fehler {
		color: var(--ui-gefahr);
	}
</style>
