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
	const mehrAktiv = $derived(pfad === '/mehr' || (data.navigation?.mehr ?? []).some((e) => istAktiv(e.href, pfad)));
</script>

{#if data.navigation}
	<div class="huelle">
		<!-- Unter 900 px: Leiste unten (Start, Kunden, Plantafel, Mehr); ab 900 px: Seitenleiste mit allen Einträgen. -->
		<nav class="hauptnav" aria-label="Hauptnavigation">
			<a href="/" class="marke nur-breit">CRM System</a>
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
	.nur-breit {
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
		.marke::before {
			content: '';
			display: inline-block;
			width: 1.5rem;
			height: 1.5rem;
			border-radius: var(--m365-radius);
			background: var(--m365-primaer);
			flex-shrink: 0;
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
			font-weight: 400;
			text-align: left;
			line-height: 1.2;
		}
		.eintrag[aria-current='page'] {
			background: var(--m365-primaer-hell);
			box-shadow: none;
			font-weight: 600;
			color: var(--m365-primaer-dunkel);
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
			margin-top: 0.5rem;
			padding-top: 0.5rem;
			border-top: 1px solid var(--m365-rand);
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
