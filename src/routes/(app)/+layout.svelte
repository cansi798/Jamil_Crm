<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { istAktiv, MOBIL_HAUPT } from '$lib/navigation';
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import NurLesenHinweis from '$lib/components/NurLesenHinweis.svelte';
	import Mikrofon from '$lib/components/Mikrofon.svelte';
	import Glocke from '$lib/components/Glocke.svelte';
	import LaufendeZeit from '$lib/components/zeit/LaufendeZeit.svelte';
	import { loesche, merkeNutzer, nutzerKennung } from '$lib/heute-kopie';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const pfad = $derived(page.url.pathname);

	// Offline-Kopie gehört nur dem angemeldeten Benutzer: Kennung merken, fremde Kopie dabei löschen
	$effect(() => {
		if (data.benutzerId) merkeNutzer(nutzerKennung(data.benutzerId));
	});
	// Aktueller Bereich für die Kopfleiste (Brotkrume): längster passender Navigationseintrag
	const bereich = $derived.by(() => {
		const alle = [...(data.navigation?.haupt ?? []), ...(data.navigation?.mehr ?? [])].filter((e) => e.href);
		return alle.filter((e) => istAktiv(e.href!, pfad)).sort((a, b) => b.href!.length - a.href!.length)[0] ?? null;
	});
	// Logo oben links (msg 3014): Seitenleiste (dunkel) bevorzugt die helle Variante, das Handy (hell) das Briefkopf-Logo
	const markeName = $derived(data.marke?.name ?? 'CRM System');
	const logoUrl = (variante: 'dunkel' | 'briefkopf', v: string) => `/api/marke/logo?variante=${variante}&v=${encodeURIComponent(v)}`;
	const logoDunkel = $derived(data.marke?.dunkel ? logoUrl('dunkel', data.marke.dunkel) : data.marke?.hell ? logoUrl('briefkopf', data.marke.hell) : null);
	const logoHell = $derived(data.marke?.hell ? logoUrl('briefkopf', data.marke.hell) : data.marke?.dunkel ? logoUrl('dunkel', data.marke.dunkel) : null);
	const mitSuche = $derived((data.navigation?.haupt ?? []).some((e) => e.href === '/kunden'));
	const mehrAktiv = $derived(
		pfad === '/mehr' || [...(data.navigation?.haupt ?? []).slice(MOBIL_HAUPT), ...(data.navigation?.mehr ?? [])].some((e) => istAktiv(e.href, pfad))
	);
	// Gruppen einklappbar; Zustand je Benutzer auf diesem Gerät (msg 2826). Die Gruppe der aktuellen Seite ist immer offen.
	let zu = $state<Record<string, boolean>>({});
	const schluessel = $derived(`crm-nav-zu:${data.benutzerId ?? ''}`);
	$effect(() => {
		try {
			zu = JSON.parse(localStorage.getItem(schluessel) ?? '{}');
		} catch {
			zu = {};
		}
	});
	function umschalten(id: string, offen: boolean) {
		zu = { ...zu, [id]: !offen };
		try {
			localStorage.setItem(schluessel, JSON.stringify(zu));
		} catch {
			/* ohne Speicher bleibt es für diese Sitzung */
		}
	}
</script>

{#if data.navigation}
	<div class="huelle" style={data.farbStil}>
		<!-- Unter 900 px: Leiste unten (Start, Kunden, Plantafel, Mehr); ab 900 px: Seitenleiste mit allen Einträgen. -->
		<nav class="hauptnav" aria-label="Hauptnavigation">
			{#if logoDunkel}
				<!-- Logo des Betriebs (msg 3014): Seitenleiste dunkel → helle Variante, sonst Briefkopf-Logo auf weißem Feld -->
				<a href="/" class="marke marke-mit-logo nur-breit" aria-label={`Zur Startseite – ${markeName}`}>
					<span class="marke-logo" class:auf-weiss={!data.marke?.dunkel}><img src={logoDunkel} alt={markeName} height="40" /></span>
				</a>
			{:else}
			<a href="/" class="marke nur-breit">
				<span class="marke-zeichen" aria-hidden="true">
					<!-- Haus mit Dachlinie, leicht handgezeichnet (Theme „Handwerk“) -->
					<svg viewBox="0 0 24 24"><path d="M3.5 11.2 12 4.3l8.6 6.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /><path d="M6 10.2V19.6h12.1V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path d="M10 19.5v-5.2h4.1v5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
				</span>
				<span class="marke-text"><span class="marke-klein">Handwerk</span>CRM System</span>
			</a>
			{/if}
			<ul class="liste">
				{#each data.navigation.haupt as e, i (e.name)}
					<li class:nur-breit-li={i >= MOBIL_HAUPT}>
						{#if e.href}
							<a href={e.href} class="eintrag" aria-current={istAktiv(e.href, pfad) ? 'page' : undefined}>
								<NavSymbol symbol={e.symbol} />
								<span class="text"><span class="name">{e.name}</span></span>
							</a>
						{:else}
							<span class="eintrag aus" aria-disabled="true">
								<NavSymbol symbol={e.symbol} />
								<span class="text">
									<span class="name">{e.name}</span>
									{#if e.hinweis}<span class="hinweis">{e.hinweis}</span>{/if}
								</span>
							</span>
						{/if}
					</li>
				{/each}
				<li class="nur-schmal">
					<a href="/mehr" class="eintrag" aria-current={mehrAktiv ? 'page' : undefined}>
						<NavSymbol symbol="mehr" />
						<span class="text"><span class="name">Mehr</span></span>
					</a>
				</li>
			</ul>
			{#each data.navigation.gruppen as g (g.id)}
				{@const aktiv = g.eintraege.some((e) => istAktiv(e.href, pfad))}
				<details class="nav-gruppe nur-breit" open={aktiv || !zu[g.id]} ontoggle={(ev) => umschalten(g.id, (ev.currentTarget as HTMLDetailsElement).open)}>
					<summary class="gruppe">{g.titel}</summary>
					<ul class="liste verwaltung">
						{#each g.eintraege as e (e.name)}
							<li>
								<a href={e.href} class="eintrag" aria-current={istAktiv(e.href, pfad) ? 'page' : undefined}>
									<NavSymbol symbol={e.symbol} />
									<span class="text"><span class="name">{e.name}</span></span>
								</a>
							</li>
						{/each}
					</ul>
				</details>
			{/each}
			<form method="POST" action="/api/abmelden" onsubmit={() => loesche()} class="abmelden nur-breit">
				<button type="submit" class="eintrag">
					<NavSymbol symbol="abmelden" />
					<span class="text"><span class="name">Abmelden</span></span>
				</button>
			</form>
		</nav>
		<div class="inhalt" class:mit-mikro={data.sprache}>
			<header class="kopfleiste nur-breit-flex">
				<div class="kopf-bereich">
					{#if bereich}
						<NavSymbol symbol={bereich.symbol} />
						<a href={bereich.href}>{bereich.name}</a>
					{/if}
				</div>
				{#if mitSuche}
					<form method="GET" action="/kunden" role="search" class="kopf-suche">
						<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
						<input type="search" name="suche" placeholder="Schnellsuche: Kunden …" aria-label="Schnellsuche Kunden" autocomplete="off" enterkeyhint="search" />
					</form>
				{/if}
				{#if data.laufendeZeit}<LaufendeZeit laufend={data.laufendeZeit} />{/if}
				{#if data.erinnern}<div class="kopf-glocke"><Glocke start={data.ungelesen} /></div>{/if}
			</header>
			{#if data.laufendeZeit}<div class="nur-schmal-zeit"><LaufendeZeit laufend={data.laufendeZeit} schmal /></div>{/if}
			{#if logoHell}
				<!-- Handy: Logo oben links auf hellem Grund (Briefkopf-Logo, sonst helle Variante auf dunklem Feld), Glocke rechts -->
				<div class="kopf-schmal">
					<a href="/" class="marke-schmal" aria-label={`Zur Startseite – ${markeName}`}>
						<span class="marke-logo" class:auf-dunkel={!data.marke?.hell}><img src={logoHell} alt={markeName} height="32" /></span>
					</a>
					{#if data.erinnern}<div class="nur-schmal-glocke"><Glocke start={data.ungelesen} schmal /></div>{/if}
				</div>
			{:else if data.erinnern}<div class="nur-schmal-glocke"><Glocke start={data.ungelesen} schmal /></div>{/if}
			<NurLesenHinweis form={page.form} />
			{@render children()}
		</div>
		{#if data.sprache}
			<!-- Sprachsteuerung (Modul „sprache“): runder Knopf unten rechts über der Navigation -->
			<Mikrofon />
		{/if}
	</div>
{:else}
	<!-- Vor-Sitzung (Einrichtung der Zwei-Faktor-Anmeldung): noch keine Navigation -->
	{@render children()}
{/if}

<style>
	/* Theme „Handwerk“: Navigation und Kopfleiste in Anthrazit, aktiver Eintrag mit Akzent (Gold bzw. Hausfarbe) */
	/* Handy: Logo-Zeile oben (heller Grund), Glocke rechts daneben */
	.kopf-schmal {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 3.25rem;
		padding: calc(0.4rem + env(safe-area-inset-top)) 0.75rem 0;
	}
	.kopf-schmal .nur-schmal-glocke :global(.gl.schmal) {
		padding: 0;
		margin-bottom: 0;
	}
	.marke-schmal {
		display: flex;
		align-items: center;
		min-width: 0;
		height: 40px;
	}
	.marke-schmal .marke-logo img {
		display: block;
		height: 32px;
		width: auto;
		max-width: min(60vw, 220px);
		object-fit: contain;
	}
	.marke-logo.auf-dunkel {
		padding: 3px 8px;
		border-radius: 8px;
		background: var(--ui-anthrazit-900);
	}
	.marke-logo.auf-dunkel img {
		height: 26px;
	}
	.nur-schmal-zeit {
		position: sticky;
		top: 0;
		z-index: 5;
	}
	/* Mobil: Leiste unten */
	.hauptnav {
		position: fixed;
		z-index: 10;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--ui-nav);
		box-shadow: 0 -4px 16px rgba(31, 30, 32, 0.18);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
	}
	.liste > li {
		flex: 1 1 0;
		min-width: 0;
	}
	/* Am Handy nur die ersten Hauptbereiche unten, der Rest unter „Mehr“ */
	.nur-breit-li {
		display: none;
	}
	.eintrag {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		width: 100%;
		min-width: var(--tippziel);
		min-height: var(--nav-hoehe);
		margin: 0;
		padding: 0.4rem 0.25rem;
		border: 0;
		border-radius: 0;
		background: none;
		color: var(--ui-nav-leise);
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1.2;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: color 150ms, background 150ms;
	}
	.eintrag[aria-current='page'] {
		color: var(--ui-akzent); /* auf Anthrazit: helle Akzentfarbe */
		font-weight: 600;
		box-shadow: inset 0 3px 0 var(--ui-akzent);
	}
	.eintrag:hover:not(.aus) {
		color: #fff;
		background: var(--ui-nav-hover);
	}
	.eintrag.aus {
		color: var(--ui-anthrazit-600);
		cursor: default;
	}
	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.hinweis {
		font-size: 0.625rem;
		font-weight: 400;
	}
	.nur-breit,
	.nur-breit-flex {
		display: none;
	}
	.inhalt {
		padding-bottom: calc(var(--nav-hoehe) + env(safe-area-inset-bottom));
	}
	.inhalt.mit-mikro {
		padding-bottom: calc(var(--nav-hoehe) + 5rem + env(safe-area-inset-bottom));
	}

	/* Desktop: Seitenleiste als eigene Spalte (Hintergrund bis ganz unten, Navigation bleibt stehen) */
	@media (min-width: 900px) {
		.huelle {
			display: grid;
			grid-template-columns: var(--seitenleiste) minmax(0, 1fr);
			min-height: 100vh;
			background: linear-gradient(90deg, var(--ui-nav) 0 var(--seitenleiste), transparent var(--seitenleiste));
		}
		.hauptnav {
			position: sticky;
			top: 0;
			bottom: auto;
			left: auto;
			right: auto;
			height: 100vh;
			align-self: start;
			width: var(--seitenleiste);
			display: flex;
			flex-direction: column;
			gap: 0;
			padding: 0 0 0.5rem;
			box-shadow: none;
			background: var(--ui-nav);
			overflow-y: auto;
			scrollbar-width: thin;
			scrollbar-color: var(--ui-anthrazit-600) transparent;
		}
		.nur-breit {
			display: block;
		}
		.nur-breit-flex {
			display: flex;
		}
		/* Kopfleiste: Bereich links, Suche Mitte/rechts, Zeit und Glocke ganz rechts */
		.kopfleiste {
			position: sticky;
			top: 0;
			z-index: 5;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;
			height: 3.5rem;
			padding: 0 1.5rem;
			background: var(--ui-anthrazit-900);
			color: var(--ui-nav-text);
		}
		.kopf-bereich {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			min-width: 0;
			color: var(--ui-nav-text);
			font-family: var(--ui-schrift-titel);
			font-size: var(--ui-schrift-s);
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
		}
		.kopf-bereich :global(.nav-symbol) {
			width: 18px;
			height: 18px;
			color: var(--ui-akzent); /* auf Anthrazit: helle Akzentfarbe */
		}
		.kopf-bereich a {
			color: inherit;
			text-decoration: none;
		}
		.kopf-bereich a:hover {
			color: #fff;
		}
		.kopf-suche {
			position: relative;
			width: min(24rem, 40vw);
			margin-left: auto;
		}
		.kopf-suche svg {
			position: absolute;
			left: 0.85rem;
			top: 50%;
			width: 15px;
			height: 15px;
			margin-top: -7.5px;
			color: var(--ui-nav-leise);
			pointer-events: none;
		}
		.kopf-suche input {
			width: 100%;
			min-height: 2.25rem;
			padding-left: 2.25rem;
			border: 1px solid rgba(255, 255, 255, 0.12);
			border-radius: 999px;
			background: rgba(255, 255, 255, 0.08);
			color: #fff;
		}
		.kopf-suche input::placeholder {
			color: var(--ui-nav-leise);
		}
		.kopf-suche input:focus {
			border-color: var(--ui-akzent);
			background: rgba(255, 255, 255, 0.12);
		}
		/* Glocke auf dunklem Grund hell (nur der Auslöser, nicht das aufklappende Feld) */
		.kopf-glocke :global(.gl-knopf) {
			color: var(--ui-nav-text);
		}
		.kopf-glocke :global(.gl-knopf:hover) {
			color: #fff;
			background: var(--ui-nav-hover);
		}
		.gruppe {
			margin: 1.25rem 0 0.35rem;
			padding: 0 1.4rem;
			color: var(--ui-akzent); /* auf Anthrazit: helle Akzentfarbe */
			font-family: var(--ui-schrift-titel);
			font-size: 0.6875rem;
			font-weight: 700;
			letter-spacing: 0.12em;
			text-transform: uppercase;
		}
		.nur-schmal {
			display: none;
		}
		.nav-gruppe summary {
			cursor: pointer;
			list-style: none;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.nav-gruppe summary::-webkit-details-marker {
			display: none;
		}
		/* Pfeil der Menügruppe: gut sichtbar (Jamil msg 3044), mittig zur Gruppenüberschrift */
		.nav-gruppe summary::after {
			content: '▾';
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex: none;
			width: 1.5rem;
			height: 1.5rem;
			margin-right: -0.25rem;
			font-size: 1.375rem;
			line-height: 1;
			transition: transform 150ms;
		}
		.nav-gruppe:not([open]) summary::after {
			transform: rotate(-90deg);
		}
		.nur-breit-li {
			display: list-item !important;
		}
		.nur-schmal-glocke,
		.nur-schmal-zeit {
			display: none;
		}
		.kopf-glocke {
			margin-left: 0.25rem;
		}
		.marke {
			display: flex;
			align-items: center;
			gap: 0.65rem;
			min-height: 3.5rem;
			padding: 0 1.25rem;
			margin-bottom: 0.5rem;
			background: var(--ui-anthrazit-900);
			color: #fff;
			text-decoration: none;
		}
		.marke-mit-logo {
			padding: 0 1rem;
		}
		.marke-logo img {
			display: block;
			height: 40px;
			width: auto;
			max-width: calc(var(--seitenleiste) - 2.5rem);
			object-fit: contain;
		}
		.marke-logo.auf-weiss {
			padding: 3px 8px;
			border-radius: 8px;
			background: #fff;
		}
		.marke-logo.auf-weiss img {
			height: 34px;
		}
		.kopf-schmal {
			display: none !important;
		}
		.marke-text {
			display: grid;
			font-family: var(--ui-schrift-titel);
			font-size: 0.9375rem;
			font-weight: 800;
			letter-spacing: 0.02em;
			line-height: 1.1;
			text-transform: uppercase;
		}
		.marke-klein {
			color: var(--ui-akzent); /* auf Anthrazit: helle Akzentfarbe */
			font-size: 0.625rem;
			font-weight: 700;
			letter-spacing: 0.16em;
		}
		.marke-zeichen {
			display: inline-grid;
			place-items: center;
			width: 2rem;
			height: 2rem;
			border-radius: 10px;
			background: var(--ui-akzent);
			color: var(--ui-akzent-auf);
			flex-shrink: 0;
		}
		.marke-zeichen svg {
			width: 1.2rem;
			height: 1.2rem;
		}
		.liste {
			flex-direction: column;
			gap: 0.1rem;
			padding: 0 0.6rem;
		}
		.eintrag {
			flex-direction: row;
			justify-content: flex-start;
			gap: 0.75rem;
			min-height: 2.75rem; /* Tippziel ≥ 44 px */
			margin: 0;
			padding: 0.375rem 0.8rem;
			border-radius: 10px;
			font-size: 0.875rem;
			font-weight: 500;
			text-align: left;
			line-height: 1.2;
			color: var(--ui-nav-text);
		}
		.eintrag[aria-current='page'] {
			position: relative;
			background: var(--ui-nav-aktiv);
			box-shadow: none;
			font-weight: 600;
			color: #fff;
		}
		.eintrag[aria-current='page'] :global(.nav-symbol) {
			color: var(--ui-akzent); /* auf Anthrazit: helle Akzentfarbe */
		}
		.eintrag[aria-current='page']::before {
			content: '';
			position: absolute;
			left: -0.6rem;
			top: 0.55rem;
			bottom: 0.55rem;
			width: 4px;
			border-radius: 0 4px 4px 0;
			background: var(--ui-akzent);
		}
		.eintrag :global(.nav-symbol) {
			width: 20px;
			height: 20px;
			flex: none;
			color: var(--ui-nav-leise);
		}
		.eintrag:not(.aus):hover {
			background: var(--ui-nav-hover);
			color: #fff;
		}
		.eintrag.aus {
			font-size: 0.875rem;
		}
		.hinweis {
			font-size: 0.75rem;
		}
		.abmelden {
			margin-top: auto;
			padding: 0.75rem 0.6rem 0;
			border-top: 1px solid rgba(255, 255, 255, 0.08);
		}
		.abmelden .eintrag {
			width: 100%;
		}
		.inhalt {
			padding-bottom: 0;
			margin-left: 0;
			min-width: 0;
		}
		.inhalt.mit-mikro {
			padding-bottom: 5.5rem;
		}
	}
</style>
