<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { istAktiv } from '$lib/navigation';
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import NurLesenHinweis from '$lib/components/NurLesenHinweis.svelte';
	import { loesche } from '$lib/heute-kopie';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const pfad = $derived(page.url.pathname);
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
		<div class="inhalt">
			<NurLesenHinweis form={page.form} />
			{@render children()}
		</div>
	</div>
{:else}
	<!-- Vor-Sitzung (Einrichtung der Zwei-Faktor-Anmeldung): noch keine Navigation -->
	{@render children()}
{/if}

<style>
	.hauptnav {
		position: fixed;
		z-index: 10;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--flaeche);
		border-top: 1px solid var(--rand);
		box-shadow: 0 -2px 8px rgb(0 0 0 / 0.05);
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
		gap: 0.15rem;
		width: 100%;
		min-width: var(--tippziel);
		min-height: var(--nav-hoehe);
		margin: 0;
		padding: 0.35rem 0.2rem;
		border: 0;
		border-radius: 0;
		background: none;
		color: var(--text-leise);
		font-size: 0.75rem;
		line-height: 1.15;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
	}
	.eintrag[aria-current='page'] {
		color: var(--primaer);
		font-weight: 700;
		box-shadow: inset 0 3px 0 var(--primaer);
	}
	.eintrag.aus {
		color: #8a9098;
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

	@media (min-width: 900px) {
		.hauptnav {
			top: 0;
			right: auto;
			width: var(--seitenleiste);
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
			padding: 0.75rem;
			border-top: 0;
			border-right: 1px solid var(--rand);
			box-shadow: none;
			background: var(--hintergrund);
			overflow-y: auto;
		}
		.nur-breit {
			display: block;
		}
		.nur-schmal {
			display: none;
		}
		.marke {
			display: flex;
			align-items: center;
			min-height: var(--tippziel);
			padding: 0 0.75rem;
			margin-bottom: 0.75rem;
			color: var(--primaer);
			font-size: 1.15rem;
			font-weight: 700;
			text-decoration: none;
		}
		.liste {
			flex-direction: column;
			gap: 0.25rem;
		}
		.eintrag {
			flex-direction: row;
			justify-content: flex-start;
			gap: 0.75rem;
			min-height: var(--tippziel);
			padding: 0.5rem 0.75rem;
			border-radius: 0.5rem;
			font-size: 1rem;
			text-align: left;
		}
		.eintrag[aria-current='page'] {
			background: var(--primaer-hell);
			box-shadow: inset 3px 0 0 var(--primaer);
		}
		.eintrag:not(.aus):hover {
			background: #e6e9ee;
		}
		.hinweis {
			font-size: 0.75rem;
		}
		.verwaltung {
			margin-top: 0.75rem;
			padding-top: 0.75rem;
			border-top: 1px solid var(--rand);
		}
		.abmelden {
			margin-top: auto;
			padding-top: 0.75rem;
		}
		.inhalt {
			padding-bottom: 0;
			margin-left: var(--seitenleiste);
		}
	}
</style>
