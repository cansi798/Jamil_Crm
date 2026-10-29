<script lang="ts" generics="K extends { id: string }">
	import type { Snippet } from 'svelte';
	import type { KachelSpalte } from '$lib/kachel-board';

	/**
	 * Gemeinsames Kachel-Board (Aufträge, Aufgaben): Spalten nebeneinander ab 700 px, darunter Status-Reiter mit einer
	 * Spalte. Ziehen und Ablegen mit Pointer Events (Maus, Stift, Finger; ab 700 px). Erlaubte Ziele werden beim Ziehen
	 * hervorgehoben, gesperrte abgeblendet. Was beim Ablegen passiert, entscheidet die Seite (`onablegen`) – dort auch
	 * die optimistische Anzeige und Rücknahme. Inhalt der Karten kommt als Snippet `karte`.
	 */
	let {
		spalten,
		ziehbar,
		zielErlaubt = () => true,
		onablegen,
		onverboten,
		karte,
		geist,
		fuss,
		meldung = '',
		fehler = false,
		leer = 'Keine Einträge',
		reiterLabel = 'Spalte wählen',
		gruppen
	}: {
		spalten: KachelSpalte<K>[];
		/** Darf diese Karte gezogen werden? */
		ziehbar: (k: K) => boolean;
		zielErlaubt?: (k: K, von: string, nach: string) => boolean;
		onablegen: (k: K, von: string, nach: string) => void;
		/** Abgelegt auf einer gesperrten Spalte. */
		onverboten?: (k: K, von: string, nach: string) => void;
		karte: Snippet<[K, string]>;
		geist: Snippet<[K]>;
		/** Optional unter den Karten einer Spalte (z. B. „50 von 80 angezeigt“). */
		fuss?: Snippet<[KachelSpalte<K>]>;
		meldung?: string;
		fehler?: boolean;
		leer?: string;
		reiterLabel?: string;
		/**
		 * Optionale Untergruppen innerhalb einer Spalte (Jamil msgs 3601 ff.: „Anfrage“ → Termin vereinbaren / vereinbart, „Angebot“ →
		 * Angebot erstellen / Angebot erstellt …): je Gruppe eine kleine Zwischenüberschrift mit Zahl, darunter ihre Karten.
		 */
		gruppen?: (spalte: string) => { id: string; titel: string; passt: (k: K) => boolean; nurWennBelegt?: boolean }[] | null;
	} = $props();

	// Handy: angezeigte Spalte (Reiter)
	let mobilSpalte = $state<string | null>(null);
	const aktiveMobil = $derived(
		mobilSpalte ?? spalten.find((s) => s.karten.length > 0)?.id ?? spalten[0]?.id ?? ''
	);
	const anzahl = (s: KachelSpalte<K>) => s.anzahl ?? s.karten.length;

	type Zug = {
		karte: K;
		von: string;
		startX: number;
		startY: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		breite: number;
		aktiv: boolean;
		ziel: string | null;
	};
	let zug = $state<Zug | null>(null);
	let klickSperre = false;

	const breitGenug = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 700px)').matches;

	function spalteBei(x: number, y: number): string | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-spalte]');
		return el?.dataset.spalte ?? null;
	}

	function runter(ev: PointerEvent, k: K, von: string) {
		if (!ziehbar(k) || !ev.isPrimary || ev.button !== 0 || !breitGenug()) return;
		// Bedienelemente der Karte (Menü, Häkchen, Formulare) nie ziehen
		if ((ev.target as Element).closest('button, summary, details[open], input, select, textarea, label')) return;
		const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
		zug = {
			karte: k,
			von,
			startX: ev.clientX,
			startY: ev.clientY,
			x: ev.clientX,
			y: ev.clientY,
			dx: ev.clientX - r.left,
			dy: ev.clientY - r.top,
			breite: r.width,
			aktiv: false,
			ziel: null
		};
	}

	function bewegen(ev: PointerEvent) {
		if (!zug) return;
		zug.x = ev.clientX;
		zug.y = ev.clientY;
		if (!zug.aktiv && Math.hypot(ev.clientX - zug.startX, ev.clientY - zug.startY) > 6) zug.aktiv = true;
		if (zug.aktiv) {
			ev.preventDefault();
			zug.ziel = spalteBei(ev.clientX, ev.clientY);
		}
	}

	function hoch(ev: PointerEvent) {
		const z = zug;
		zug = null;
		if (!z || !z.aktiv) return;
		klickSperre = true; // der folgende click gehört zum Ziehen, nicht zum Öffnen
		setTimeout(() => (klickSperre = false), 0);
		const ziel = spalteBei(ev.clientX, ev.clientY);
		if (!ziel || ziel === z.von) return;
		if (!zielErlaubt(z.karte, z.von, ziel)) {
			onverboten?.(z.karte, z.von, ziel);
			return;
		}
		onablegen(z.karte, z.von, ziel);
	}

	function abbrechen() {
		zug = null;
	}

	function klick(ev: MouseEvent) {
		if (klickSperre) {
			ev.preventDefault();
			ev.stopPropagation();
		}
	}

	function taste(ev: KeyboardEvent) {
		if (ev.key === 'Escape' && zug) zug = null;
	}

	const zielKlasse = (s: string) => {
		if (!zug?.aktiv) return '';
		if (s === zug.von) return 'quelle';
		return zielErlaubt(zug.karte, zug.von, s) ? (zug.ziel === s ? 'ziel erlaubt' : 'erlaubt') : 'gesperrt';
	};
</script>

{#snippet eintrag(k: K, spalte: string)}
	<li
		class="ab-karte"
		class:gezogen={zug?.aktiv && zug.karte.id === k.id}
		class:ziehbar={ziehbar(k)}
		data-karte={k.id}
		onpointerdown={(ev) => runter(ev, k, spalte)}
		onclickcapture={klick}
	>
		{@render karte(k, spalte)}
	</li>
{/snippet}

<svelte:window onkeydown={taste} onpointermove={bewegen} onpointerup={hoch} onpointercancel={abbrechen} />

<p class="ab-meldung" class:fehler role={fehler ? 'alert' : 'status'} aria-live="polite">{meldung}</p>

<nav class="ab-reiter" aria-label={reiterLabel}>
	{#each spalten as s (s.id)}
		<button
			type="button"
			class="ab-reiter-knopf"
			aria-pressed={aktiveMobil === s.id}
			onclick={() => (mobilSpalte = s.id)}
		>
			{s.titel} <span class="ab-zahl">{anzahl(s)}</span>
		</button>
	{/each}
</nav>

<div class="ab-board" class:zieht={zug?.aktiv} style={`--spalten: ${spalten.length}`}>
	{#each spalten as s (s.id)}
		<section
			class={`ab-spalte ${zielKlasse(s.id)}`}
			class:mobil-aktiv={aktiveMobil === s.id}
			style={`--farbe: ${s.farbe}`}
			data-spalte={s.id}
			aria-labelledby={`ab-kopf-${s.id}`}
		>
			<header class="ab-kopf">
				<span class="ab-punkt" aria-hidden="true"></span>
				<h2 id={`ab-kopf-${s.id}`}>{s.titel}</h2>
				<span class="ab-zahl" aria-label={`${anzahl(s)} Einträge`}>{anzahl(s)}</span>
			</header>
			<ul class="ab-karten">
				{#if gruppen?.(s.id) && s.karten.length > 0}
					{#each gruppen(s.id) ?? [] as g (g.id)}
						{@const drin = s.karten.filter(g.passt)}
						<!-- `nurWennBelegt`: z. B. „Schritt übersprungen“ (Ablauf je Auftragsquelle) erscheint nur, wenn Karten drin sind -->
						{#if !g.nurWennBelegt || drin.length > 0}
							<li class="ab-gruppe" data-gruppe={g.id} role="presentation">
								<h3 class="ab-gruppe-titel">{g.titel} <span class="ab-gruppe-zahl"><span class="ab-unsichtbar">(</span>{drin.length}<span class="ab-unsichtbar">)</span></span></h3>
							</li>
							{#each drin as k (k.id)}
								{@render eintrag(k, s.id)}
							{/each}
						{/if}
					{/each}
				{:else}
					{#each s.karten as k (k.id)}
						{@render eintrag(k, s.id)}
					{:else}
						<li class="ab-leer">{leer}</li>
					{/each}
				{/if}
			</ul>
			{#if fuss}{@render fuss(s)}{/if}
		</section>
	{/each}
</div>

{#if zug?.aktiv}
	<div
		class="ab-geist"
		style={`left:${zug.x - zug.dx}px; top:${zug.y - zug.dy}px; width:${zug.breite}px`}
		aria-hidden="true"
	>
		{@render geist(zug.karte)}
	</div>
{/if}

<style>
	/* Untergruppe in einer Spalte: dezente Zwischenüberschrift mit Zahl (Jamil msg 3601) */
	.ab-gruppe {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0.35rem 0.15rem 0.1rem;
		padding-bottom: 0.2rem;
		border-bottom: 1px dashed var(--m365-rand-stark, #d6d1c7);
		color: var(--m365-text-leise);
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		list-style: none;
	}
	.ab-gruppe-titel {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0;
		font: inherit;
	}
	.ab-unsichtbar {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.ab-gruppe:first-child {
		margin-top: 0;
	}
	.ab-gruppe-zahl {
		min-width: 1.25rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: var(--m365-flaeche-hover, #f3f2f1);
		text-align: center;
		letter-spacing: 0;
	}
	.ab-meldung {
		min-height: 1.25rem;
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.ab-meldung.fehler {
		color: var(--m365-fehler);
		font-weight: 600;
	}

	/* Handy: Reiter, eine Spalte */
	.ab-reiter {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		margin: 0 0 0.75rem;
		padding-bottom: 0.25rem;
		scrollbar-width: thin;
	}
	.ab-reiter-knopf {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: var(--tippziel, 44px);
		padding: 0 0.85rem;
		border: 1px solid var(--m365-rand-stark);
		border-radius: 999px;
		background: var(--m365-flaeche);
		color: var(--m365-text);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.ab-reiter-knopf[aria-pressed='true'] {
		border-color: var(--m365-primaer);
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
	}
	.ab-reiter-knopf[aria-pressed='true'] .ab-zahl {
		background: rgba(255, 255, 255, 0.25);
		color: #fff;
	}

	.ab-board {
		display: block;
	}
	.ab-spalte {
		display: none;
	}
	.ab-spalte.mobil-aktiv {
		display: block;
	}

	@media (min-width: 700px) {
		.ab-reiter {
			display: none;
		}
		.ab-board {
			display: grid;
			/* gleiches Raster wie die Kennzahl-Kacheln darüber (KennzahlKacheln raster="board", msg 3141) */
			grid-template-columns: repeat(var(--spalten), minmax(var(--board-spalte-min, 12rem), 1fr));
			gap: var(--board-luecke, 0.75rem);
			align-items: start;
			overflow-x: auto;
			padding-bottom: 0.5rem;
		}
		.ab-spalte {
			display: block;
		}
		/* Lange Spalten scrollen in sich – Spaltenköpfe und Ablageziele bleiben sichtbar (wie Planner) */
		.ab-karten {
			max-height: calc(100vh - 14rem);
			max-height: calc(100dvh - 14rem);
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: 2px;
			margin: -2px;
		}
	}

	.ab-spalte {
		background: var(--m365-flaeche-hover);
		border-radius: var(--m365-radius-karte);
		padding: 0.5rem 0.5rem 0.75rem;
		border-top: 3px solid var(--farbe);
		outline: 2px solid transparent;
		outline-offset: -2px;
		transition: background 120ms, outline-color 120ms, opacity 120ms;
	}
	.ab-spalte.erlaubt {
		outline-color: var(--m365-rand-stark);
		outline-style: dashed;
	}
	.ab-spalte.ziel {
		outline-color: var(--m365-primaer);
		outline-style: solid;
		background: var(--m365-primaer-hell);
	}
	.ab-spalte.gesperrt {
		opacity: 0.45;
	}

	.ab-kopf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.25rem 0.5rem;
	}
	.ab-punkt {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--farbe);
	}
	.ab-kopf h2 {
		flex: 1;
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.ab-zahl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.375rem;
		border-radius: var(--m365-radius-gross);
		background: var(--m365-rand);
		color: var(--m365-text-leise);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.ab-karten {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		min-height: 4rem;
	}
	.ab-karte {
		position: relative;
		padding: 0.6rem 0.7rem 0.7rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
		transition: box-shadow 150ms, opacity 150ms;
	}
	.ab-karte:hover {
		box-shadow: var(--m365-schatten-hoch);
	}
	@media (min-width: 700px) {
		.ab-karte.ziehbar {
			cursor: grab;
			touch-action: none;
			user-select: none;
		}
	}
	.ab-karte.gezogen {
		opacity: 0.35;
	}
	.ab-leer {
		padding: 1.25rem 0.5rem;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--m365-text-leicht);
	}

	.ab-geist {
		position: fixed;
		z-index: 50;
		display: grid;
		gap: 0.15rem;
		padding: 0.6rem 0.7rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten-hoch);
		pointer-events: none;
		transform: rotate(2deg);
		font-size: 0.875rem;
	}
	.ab-board.zieht {
		cursor: grabbing;
	}
</style>
