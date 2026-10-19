<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { istAktiv } from '$lib/navigation';
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import NurLesenHinweis from '$lib/components/NurLesenHinweis.svelte';
	import Mikrofon from '$lib/components/Mikrofon.svelte';
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
	const mitSuche = $derived((data.navigation?.haupt ?? []).some((e) => e.href === '/kunden'));
	const mehrAktiv = $derived(pfad === '/mehr' || (data.navigation?.mehr ?? []).some((e) => istAktiv(e.href, pfad)));
</script>

{#if data.navigation}
	<div class="huelle">
		<!-- Unter 900 px: Leiste unten (Start, Kunden, Plantafel, Mehr); ab 900 px: Seitenleiste mit allen Einträgen. -->
		<nav class="hauptnav" aria-label="Hauptnavigation">
			<a href="/" class="marke nur-breit">
				<span class="marke-zeichen" aria-hidden="true">
					<svg viewBox="0 0 24 24"><path d="M5 17V9l7-4 7 4v8l-7 4-7-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M12 13v8M5 9l7 4 7-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
				</span>
				CRM System
			</a>
			<ul class="liste">
				{#each data.navigation.haupt as e (e.name)}
					<li>
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
			{#if data.navigation.mehr.length > 0}
				<p class="gruppe nur-breit" aria-hidden="true">Weitere Bereiche</p>
				<ul class="liste verwaltung nur-breit">
					{#each data.navigation.mehr as e (e.name)}
						<li>
							<a href={e.href} class="eintrag" aria-current={istAktiv(e.href, pfad) ? 'page' : undefined}>
								<NavSymbol symbol={e.symbol} />
								<span class="text"><span class="name">{e.name}</span></span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
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
			</header>
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
	/* Mobil: Bottom-Tab-Bar (wie M365-App auf dem Handy) */
	.hauptnav {
		position: fixed;
		z-index: 10;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--m365-flaeche);
		border-top: 1px solid var(--m365-rand);
		box-shadow: var(--m365-schatten);
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
		color: var(--m365-text-leise);
		font-family: var(--m365-schrift);
		font-size: 0.6875rem;
		font-weight: 400;
		line-height: 1.2;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: color 150ms, background 150ms;
	}
	.eintrag[aria-current='page'] {
		color: var(--m365-primaer);
		font-weight: 600;
		box-shadow: inset 0 2px 0 var(--m365-primaer);
	}
	.eintrag:hover:not(.aus) {
		color: var(--m365-text);
		background: var(--m365-flaeche-hover);
	}
	.eintrag.aus {
		color: var(--m365-text-leicht);
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

	/* Desktop: linke Seitenleiste wie M365 App */
	@media (min-width: 900px) {
		.hauptnav {
			top: 0;
			right: auto;
			width: var(--seitenleiste);
			display: flex;
			flex-direction: column;
			gap: 0;
			padding: 0;
			border-top: 0;
			border-right: 1px solid var(--m365-rand);
			box-shadow: none;
			background: var(--m365-nav);
			overflow-y: auto;
		}
		.nur-breit {
			display: block;
		}
		.nur-breit-flex {
			display: flex;
		}
		/* Kopfleiste: Bereich (Brotkrume) links, Suche rechts */
		.kopfleiste {
			position: sticky;
			top: 0;
			z-index: 5;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;
			height: 3.5rem;
			padding: 0 1.5rem;
			border-bottom: 1px solid var(--ui-rand);
			background: rgba(255, 255, 255, 0.92);
			backdrop-filter: saturate(1.4) blur(8px);
		}
		.kopf-bereich {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			min-width: 0;
			color: var(--ui-text-leise);
			font-size: var(--ui-schrift-m);
			font-weight: 500;
		}
		.kopf-bereich :global(.nav-symbol) {
			width: 18px;
			height: 18px;
		}
		.kopf-bereich a {
			color: inherit;
			text-decoration: none;
		}
		.kopf-bereich a:hover {
			color: var(--ui-text);
		}
		.kopf-suche {
			position: relative;
			width: min(22rem, 40vw);
		}
		.kopf-suche svg {
			position: absolute;
			left: 0.75rem;
			top: 50%;
			width: 15px;
			height: 15px;
			margin-top: -7.5px;
			color: var(--ui-text-leise);
			pointer-events: none;
		}
		.kopf-suche input {
			width: 100%;
			min-height: 2.25rem;
			padding-left: 2.1rem;
			border-color: var(--ui-rand);
			border-radius: 999px;
			background: var(--ui-hintergrund);
		}
		.kopf-suche input:focus {
			background: var(--ui-flaeche);
		}
		.gruppe {
			margin: 1rem 0 0.25rem;
			padding: 0 1.25rem;
			color: var(--ui-text-leise);
			font-size: var(--ui-schrift-xs);
			font-weight: 600;
			letter-spacing: 0.04em;
			text-transform: uppercase;
		}
		.nur-schmal {
			display: none;
		}
		/* Branding-Bereich (wie M365 App-Kopf) */
		.marke {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			min-height: 3rem;
			padding: 0 1rem;
			margin-bottom: 0.5rem;
			color: var(--m365-text);
			font-family: var(--m365-schrift);
			font-size: 1.125rem;
			font-weight: 600;
			text-decoration: none;
			letter-spacing: -0.01em;
		}
		.marke {
			min-height: 3.5rem;
			margin-bottom: 0.25rem;
			padding: 0 1.25rem;
			font-size: 1rem;
			font-weight: 700;
			letter-spacing: -0.01em;
		}
		.marke-zeichen {
			display: inline-grid;
			place-items: center;
			width: 1.75rem;
			height: 1.75rem;
			border-radius: 8px;
			background: linear-gradient(135deg, var(--ui-akzent), #7c5cf0);
			color: #fff;
			flex-shrink: 0;
		}
		.marke-zeichen svg {
			width: 1.1rem;
			height: 1.1rem;
		}
		.liste {
			flex-direction: column;
			gap: 0;
			padding: 0 0.5rem;
		}
		.eintrag {
			flex-direction: row;
			justify-content: flex-start;
			gap: 0.75rem;
			min-height: 2.75rem; /* Tippziel ≥ 44 px */
			margin: 0;
			padding: 0.375rem 0.75rem;
			border-radius: var(--m365-radius);
			font-family: var(--m365-schrift);
			font-size: 0.875rem;
			font-weight: 500;
			text-align: left;
			line-height: 1.2;
		}
		.eintrag[aria-current='page'] {
			position: relative;
			background: var(--ui-akzent-hell);
			box-shadow: none;
			font-weight: 600;
			color: var(--ui-akzent);
		}
		.eintrag[aria-current='page']::before {
			content: '';
			position: absolute;
			left: -0.5rem;
			top: 0.6rem;
			bottom: 0.6rem;
			width: 3px;
			border-radius: 0 3px 3px 0;
			background: var(--ui-akzent);
		}
		.eintrag :global(.nav-symbol) {
			width: 20px;
			height: 20px;
			flex: none;
		}
		.eintrag:not(.aus):hover {
			background: var(--m365-flaeche-hover);
		}
		.eintrag.aus {
			font-size: 0.875rem;
		}
		.hinweis {
			font-size: 0.75rem;
		}
		.verwaltung {
			margin-top: 0;
		}
		.verwaltung .liste {
			padding: 0 0.5rem;
		}
		.abmelden {
			margin-top: auto;
			padding: 0.5rem;
			border-top: 1px solid var(--m365-rand);
		}
		.abmelden .eintrag {
			width: 100%;
		}
		.inhalt {
			padding-bottom: 0;
			margin-left: var(--seitenleiste);
		}
		.inhalt.mit-mikro {
			padding-bottom: 5.5rem;
		}
	}
</style>
