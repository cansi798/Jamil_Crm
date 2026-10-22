<script lang="ts" module>
	export type Kachel = {
		id: string;
		titel: string;
		wert: string;
		/** kleine Zeile darunter (z. B. „im Zeitraum“, Trend) */
		info?: string | null;
		/** Klick filtert die Liste (Link mit Filter in der Adresse) */
		href?: string | null;
		/** Farbe des Randes (Status) */
		ton?: 'gruen' | 'orange' | 'rot' | 'blau' | 'lila' | 'grau' | 'akzent' | null;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { ZEITRAUM_ARTEN, ZEITRAUM_NAMEN, type ZeitraumArt } from '$lib/kennzahlen';

	/**
	 * Kennzahl-Kacheln oben auf Übersichtsseiten (Jamil msgs 2799/2801/2803): Zeitraum wählbar, Klick auf eine Kachel
	 * filtert die Liste darunter (aktive Kachel hervorgehoben, erneuter Klick hebt den Filter auf).
	 * Kompakt (msg 2944): Zahl links, Titel und Hinweis rechts daneben; am Handy Zählkacheln zu dritt, Wertkacheln zu
	 * zweit je Zeile. Der Block lässt sich ein-/ausblenden (je Benutzer und Seite auf diesem Gerät gemerkt).
	 * Nie Text verschlucken (msg 3057): Titel und Hinweis brechen um statt „…“; Kacheln mit langem Wert (Betrag, %)
	 * stellen den Wert über den Titel und verkleinern ihn notfalls passend zur Kachelbreite; der Streifen bricht in die
	 * nächste Zeile um.
	 */
	let {
		kacheln,
		zeitraum,
		zeitraumLink,
		aktiv = null,
		label = 'Kennzahlen',
		raster = null,
		zusatz,
		reihe = $bindable()
	}: {
		kacheln: Kachel[];
		zeitraum: ZeitraumArt;
		zeitraumLink: (art: ZeitraumArt) => string;
		aktiv?: string | null;
		label?: string;
		/**
		 * 'board': Kacheln stehen genau über den Spalten eines Kanban-Boards darunter (gleiches Raster aus
		 * --board-spalte-min/--board-luecke, je Kachel eine Spalte; msg 3141). 'gleich': alle Kacheln in einer Reihe,
		 * gleich breit. Sonst frei umbrechend.
		 */
		raster?: 'board' | 'gleich' | null;
		/** kleine Zusatzangabe im Kopf rechts neben dem Zeitraum (z. B. „Offen: 2.572 €“) */
		zusatz?: Snippet;
		/** die Kachelreihe (z. B. um sie mit dem Board mitzuscrollen) */
		reihe?: HTMLDivElement;
	} = $props();

	/** reine Zählkachel (kurze Zahl) → am Handy schmaler */
	const istZahl = (k: Kachel) => /^\d{1,4}$/.test(k.wert);
	const kurz = (a: ZeitraumArt) => (a === '12monate' ? '12 Mon.' : a === 'alle' ? 'Gesamt' : ZEITRAUM_NAMEN[a].replace(/^(Dieser|Dieses) /, ''));

	const schluessel = $derived(`crm-kz-zu:${page.data.benutzerId ?? ''}:${page.url.pathname}`);
	let zu = $state(false);
	$effect(() => {
		try {
			zu = localStorage.getItem(schluessel) === '1';
		} catch {
			zu = false;
		}
	});
	function umschalten() {
		zu = !zu;
		try {
			if (zu) localStorage.setItem(schluessel, '1');
			else localStorage.removeItem(schluessel);
		} catch {
			// privates Fenster: gilt nur bis zum Neuladen
		}
	}
	const id = $derived(`kz-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`);
</script>

<section class="kz" class:zu aria-label={label}>
	<div class="kz-kopf">
		<button type="button" class="kz-auf" aria-expanded={!zu} aria-controls={id} onclick={umschalten}>
			<span class="kz-pfeil" aria-hidden="true">▾</span>
			<span class="ui-eyebrow">{label} · {ZEITRAUM_NAMEN[zeitraum]}</span>
			<span class="unsichtbar">– Kennzahlen {zu ? 'einblenden' : 'ausblenden'}</span>
		</button>
		{#if zusatz && !zu}<span class="kz-zusatz">{@render zusatz()}</span>{/if}
		{#if !zu}
			<nav class="kz-zeitraum" aria-label="Zeitraum">
				{#each ZEITRAUM_ARTEN as a (a)}
					<a href={zeitraumLink(a)} aria-current={a === zeitraum ? 'page' : undefined} data-sveltekit-noscroll data-sveltekit-keepfocus>{kurz(a)}</a>
				{/each}
			</nav>
		{/if}
	</div>
	<!-- bewusst keine Liste: Listenseiten (Tests, Screenreader) finden darunter weiter „die“ Liste der Einträge -->
	<div class="kz-reihe" class:raster-board={raster === 'board'} class:raster-gleich={raster === 'gleich'} style:--kz-spalten={raster ? kacheln.length : undefined} bind:this={reihe} id={id} role="group" aria-label={`${label}: Kennzahlen`} hidden={zu}>
		{#each kacheln as k (k.id)}
			<div class="kz-zelle" class:zahl={istZahl(k)}>
				{#if k.href}
					<a href={k.href} class={`kz-kachel ton-${k.ton ?? 'akzent'}`} class:aktiv={aktiv === k.id} aria-current={aktiv === k.id ? 'true' : undefined} data-sveltekit-noscroll title={k.info ? `${k.titel}: ${k.info}` : k.titel}>
						<strong class="kz-wert">{k.wert}</strong>
						<span class="kz-titel">{k.titel}</span>
						{#if k.info}<span class="kz-info">{k.info}</span>{/if}
					</a>
				{:else}
					<div class={`kz-kachel ton-${k.ton ?? 'akzent'}`} title={k.info ? `${k.titel}: ${k.info}` : k.titel}>
						<strong class="kz-wert">{k.wert}</strong>
						<span class="kz-titel">{k.titel}</span>
						{#if k.info}<span class="kz-info">{k.info}</span>{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.kz {
		margin: 0 0 var(--ui-abstand-block);
	}
	.kz.zu {
		margin-bottom: 0.5rem;
	}
	.kz-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.3rem 0.75rem;
		margin-bottom: 0.4rem;
	}
	.kz-auf {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2rem;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
	}
	.kz-pfeil {
		color: var(--ui-text-leise);
		font-size: 0.75rem;
		transition: transform 150ms;
	}
	.zu .kz-pfeil {
		transform: rotate(-90deg);
	}
	.kz-auf:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
		border-radius: 4px;
	}
	/* kleiner Zeitraum-Schalter (bewusst nicht .ui-umschalter: der gehört in die Filterleiste) */
	.kz-zeitraum {
		display: inline-flex;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
		gap: 1px;
		padding: 2px;
		border: 1px solid var(--ui-rand);
		border-radius: 999px;
		background: var(--ui-grau-hell);
	}
	.kz-zeitraum a {
		display: inline-flex;
		align-items: center;
		min-height: 1.6rem;
		padding: 0 0.6rem;
		border-radius: 999px;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.kz-zeitraum a[aria-current='page'] {
		background: var(--ui-flaeche);
		color: var(--ui-text);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}
	@media (pointer: coarse) {
		.kz-zeitraum a {
			min-height: 2.25rem;
		}
	}
	.kz-reihe {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: 0.4rem;
		margin: 0;
		padding: 0;
	}
	.kz-reihe[hidden] {
		display: none;
	}
	/* Kopf: Zusatzangabe rechts vor dem Zeitraum */
	.kz-zusatz {
		margin-left: auto;
		font-size: var(--ui-schrift-xs);
		color: var(--ui-text-leise);
		white-space: nowrap;
	}
	/* Raster wie das Kanban-Board darunter: je Kachel eine Spalte, gleiche Breiten und Lücken (msg 3141) */
	@media (min-width: 700px) {
		.kz-reihe.raster-board {
			grid-template-columns: repeat(var(--kz-spalten), minmax(var(--board-spalte-min), 1fr));
			gap: var(--board-luecke);
			overflow-x: auto;
			scrollbar-width: none;
		}
		.kz-reihe.raster-board::-webkit-scrollbar {
			display: none;
		}
		.kz-reihe.raster-gleich {
			grid-template-columns: repeat(var(--kz-spalten), minmax(0, 1fr));
		}
	}
	/* nie über die Kachel hinaus (msg 3047: abgeschnittene €-Kachel) – Inhalt bleibt in seiner Zelle */
	.kz-zelle {
		min-width: 0;
		container-type: inline-size;
	}
	/* Geldbeträge u. Ä. (keine kurze Zahl): Wert oben, Titel und Hinweis darunter – passt in jede Zellbreite;
	   die Schrift des Werts richtet sich nach der Kachelbreite statt ihn abzuschneiden (msg 3057) */
	.kz-zelle:not(.zahl) .kz-kachel {
		grid-template-columns: minmax(0, 1fr);
	}
	.kz-zelle:not(.zahl) .kz-wert {
		grid-row: auto;
		font-size: clamp(0.95rem, 11cqi, 1.375rem);
	}
	.kz-zelle:not(.zahl) .kz-titel:last-child {
		grid-row: auto;
	}
	/* Zahl links, Titel + Hinweis rechts: zwei flache Zeilen statt drei */
	.kz-kachel {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-rows: auto auto;
		align-items: center;
		align-content: center; /* neben höheren Kacheln (umbrochener Titel) bleibt der Inhalt kompakt in der Mitte */
		column-gap: 0.55rem;
		height: 100%;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--ui-rand);
		border-left: 3px solid var(--kz-ton);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		text-decoration: none;
		transition: box-shadow 150ms, border-color 150ms;
	}
	a.kz-kachel:hover {
		box-shadow: var(--ui-schatten-hoch);
	}
	a.kz-kachel:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.kz-kachel.aktiv {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent-zart);
		box-shadow: inset 0 0 0 1px var(--ui-akzent);
	}
	.kz-wert {
		grid-row: 1 / span 2;
		font-family: var(--ui-schrift-titel);
		font-size: 1.375rem;
		font-weight: 800;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* umbrechen statt abschneiden (msg 3057) */
	.kz-titel,
	.kz-info {
		min-width: 0;
		white-space: normal;
		overflow-wrap: break-word;
		hyphens: auto;
		line-height: 1.3;
	}

	.kz-titel {
		color: var(--ui-text);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
	}
	.kz-info {
		color: var(--ui-text-leise);
		font-size: 0.6875rem;
	}
	.kz-titel:last-child {
		grid-row: 1 / span 2;
	}
	.ton-akzent { --kz-ton: var(--ui-akzent); }
	.ton-gruen { --kz-ton: var(--ui-gruen); }
	.ton-orange { --kz-ton: var(--ui-orange); }
	.ton-rot { --kz-ton: var(--ui-rot); }
	.ton-blau { --kz-ton: var(--ui-blau); }
	.ton-lila { --kz-ton: var(--ui-lila); }
	.ton-grau { --kz-ton: var(--ui-grau); }
	/* Handy: Zählkacheln zu dritt, Wertkacheln zu zweit; Zahl über dem Titel */
	@media (max-width: 40rem) {
		.kz-reihe {
			grid-template-columns: repeat(6, minmax(0, 1fr));
			gap: 0.35rem;
		}
		.kz-zelle {
			grid-column: span 3;
		}
		.kz-zelle.zahl {
			grid-column: span 2;
		}
		.kz-kachel {
			grid-template-columns: minmax(0, 1fr);
			padding: 0.35rem 0.5rem;
		}
		.kz-wert {
			grid-row: auto;
			font-size: 1.2rem;
		}
		.kz-titel:last-child {
			grid-row: auto;
		}
	}
</style>
