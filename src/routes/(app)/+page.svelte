<script lang="ts">
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import HeuteListe from '$lib/components/HeuteListe.svelte';
	import ZeitKnoepfe from '$lib/components/zeit/ZeitKnoepfe.svelte';
	import { loesche, speichere } from '$lib/heute-kopie';
	import { tagKurz } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Kopie für schlechtes Netz (nur auf diesem Gerät, bis zum Abmelden bzw. bis morgen)
	$effect(() => {
		if (data.heute && data.benutzerId) speichere(data.benutzerId, data.heuteTag, data.heute, new Date());
		else loesche(); // kein Zugriff auf Einsätze → auch keine (alte) Kopie auf diesem Gerät
	});

	const bereiche = $derived((data.navigation?.haupt ?? []).filter((e) => e.symbol !== 'start'));
</script>

<svelte:head>
	<title>Start – CRM System</title>
</svelte:head>

<main class="start">
	<header class="seiten-kopf">
		<h1>Start</h1>
		{#if data.darfKundeAnlegen}
			<a href="/kunden/neu" class="knopf-gefuellt">+ Kunde</a>
		{/if}
	</header>

	{#if data.kunden}
		<form method="GET" action="/kunden" role="search" class="suche">
			<input
				type="search"
				name="suche"
				placeholder="Kunden suchen"
				aria-label="Kunden suchen"
				autocomplete="off"
				enterkeyhint="search"
			/>
			<button type="submit" class="knopf-subtil">Suchen</button>
		</form>
	{/if}

	{#if data.zeit}
		<section aria-labelledby="zeit-titel" class="heute-karte zeit-karte" data-testid="heute-zeiterfassung">
			<div class="plan-kopf">
				<h2 id="zeit-titel">Zeiterfassung</h2>
				<a href="/zeiten" class="zeit-link">Meine Zeiten</a>
			</div>
			{#each data.zeit.auftraege as a (a.id)}
				<div class="zeit-auftrag">
					<p class="zeit-auftrag-titel"><a href={`/auftraege/${a.id}`}>{a.nummer} · {a.titel}</a>{#if a.kunde}<small>{a.kunde}</small>{/if}</p>
					<ZeitKnoepfe auftragId={a.id} titel={`${a.nummer} ${a.titel}`} laufend={data.zeit.laufend} kompakt />
				</div>
			{:else}
				<p class="leise">Heute keine Aufträge eingeplant – Zeiten starten Sie im Auftrag selbst.</p>
			{/each}
		</section>
	{/if}

	{#if data.monat}
		<a href={data.monat.link} class="heute-karte monat-kachel" class:erreicht={data.monat.erreicht} aria-label={`Diesen Monat: ${data.monat.satz} – Auslastung öffnen`}>
			<span class="monat-titel">Diesen Monat</span>
			<span class="monat-satz">{data.monat.satz}</span>
			{#if data.monat.kalkulationFehlt}<small>Kalkulation unvollständig – Kosten und freie Stunden fehlen.</small>{/if}
		</a>
	{/if}

	{#if data.plan}
		<section aria-labelledby="heute-titel" class="heute-karte plan">
			<div class="plan-kopf">
				<h2 id="heute-titel">Heute <small>{tagKurz(data.heuteTag)}</small></h2>
				{#if data.personen.length > 0}
					<form method="GET" class="plan-person">
						<select name="person" aria-label="Person" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
							{#each data.personen as p (p.id)}<option value={p.id} selected={p.id === data.plan.person.id}>{p.id === data.benutzerId ? `Ich (${p.name})` : p.name}</option>{/each}
						</select>
						<noscript><button type="submit">Zeigen</button></noscript>
					</form>
				{/if}
			</div>
			<p class="plan-text">{data.plan.text}</p>
			{#each [{ titel: 'Termine', liste: data.plan.termine }, { titel: 'To-dos', liste: data.plan.todos }, { titel: 'Nachfassen', liste: data.plan.nachfassen }] as ab (ab.titel)}
				{#if ab.liste.length > 0}
					<h3>{ab.titel}</h3>
					<ul class="plan-liste">
						{#each ab.liste as e, i (i)}
							<li class:ueberfaellig={e.ueberfaellig}>
								<span class="plan-zeit">{e.zeit}</span>
								<span class="plan-was"><a href={e.link}>{e.titel}</a>{#if e.ort}<small>{e.ort}</small>{/if}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		</section>
	{:else if data.heute}
		<section aria-labelledby="heute-titel" class="heute-karte">
			<h2 id="heute-titel">Meine Einsätze heute <small>{tagKurz(data.heuteTag)}</small></h2>
			<HeuteListe einsaetze={data.heute} />
		</section>
	{/if}

	{#if bereiche.length > 0}
		<h2 class="bereiche-titel">Bereiche</h2>
		<ul class="kacheln">
			{#each bereiche as e (e.name)}
				<li>
					{#if e.href}
						<a href={e.href} class="kachel">
							<NavSymbol symbol={e.symbol} />
							<span>{e.name}</span>
						</a>
					{:else}
						<span class="kachel aus" aria-disabled="true">
							<NavSymbol symbol={e.symbol} />
							<span>{e.name}</span>
							{#if e.hinweis}<small>{e.hinweis}</small>{/if}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="leise">Für Ihr Konto sind noch keine Bereiche freigeschaltet.</p>
	{/if}
</main>

<style>
	.start {
		margin: 0 auto;
		padding: 1.5rem;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.01em;
	}
	.bereiche-titel {
		font-size: 1rem;
		font-weight: 600;
		margin: 1.5rem 0 0.75rem;
		color: var(--m365-text);
	}

	/* Suche wie M365-CommandBar */
	.suche {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.suche input {
		width: 100%;
		min-height: var(--tippziel);
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--m365-rand-stark);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
	}
	.suche input:focus {
		border-color: var(--m365-primaer);
		box-shadow: 0 0 0 2px rgba(0,120,212,0.2);
		outline: none;
	}

	/* Kachel „Diesen Monat“ (Gewinn verplant, Stunden frei) */
	.monat-kachel {
		display: grid;
		gap: 0.2rem;
		color: inherit;
		text-decoration: none;
		border-left: 6px solid var(--m365-fehler);
	}
	.monat-kachel.erreicht {
		border-left-color: #107c10;
	}
	.monat-kachel:hover .monat-satz,
	.monat-kachel:focus-visible .monat-satz {
		text-decoration: underline;
	}
	.monat-titel {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--m365-text-leise);
	}
	.monat-satz {
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.5;
	}
	.monat-kachel small {
		color: var(--m365-text-leise);
	}

	/* Kachel „Heute“ (Tagesplan) */
	.plan-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.plan-kopf h2 {
		margin: 0;
	}
	.plan-person select {
		min-height: 2.25rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--m365-rand-stark);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
		font: inherit;
		font-size: 0.875rem;
	}
	.plan-text {
		margin: 0.5rem 0;
		color: var(--m365-text-leise);
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.plan h3 {
		margin: 0.75rem 0 0.35rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.plan-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.plan-liste li {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.plan-liste li.ueberfaellig .plan-zeit {
		color: var(--m365-fehler);
		font-weight: 600;
	}
	.plan-was {
		display: grid;
		overflow-wrap: anywhere;
	}
	.plan-was small {
		color: var(--m365-text-leise);
	}

	/* Einsätze als Karte */
	.heute-karte {
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
		padding: 1.25rem 1.5rem;
		margin-bottom: 1.5rem;
	}
	.heute-karte h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: var(--m365-text);
	}
	.heute-karte h2 small {
		color: var(--m365-text-leise);
		font-weight: 400;
	}

	/* Bereiche-Kacheln (wie M365 App-Launcher) */
	.kacheln {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0.75rem;
	}
	.kachel {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		min-height: 5.5rem;
		padding: 1rem;
		border-radius: var(--m365-radius-karte);
		background: var(--m365-flaeche);
		box-shadow: var(--m365-schatten);
		color: var(--m365-text);
		font-family: var(--m365-schrift);
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
		transition: box-shadow 150ms, transform 150ms;
	}
	a.kachel:hover {
		box-shadow: var(--m365-schatten-hoch);
		transform: translateY(-1px);
	}
	.kachel :global(.nav-symbol) {
		color: var(--m365-primaer);
	}
	.kachel.aus {
		color: var(--m365-text-leicht);
		font-weight: 400;
		box-shadow: none;
		border: 1px dashed var(--m365-rand);
		background: transparent;
	}
	.kachel.aus :global(.nav-symbol) {
		color: inherit;
	}
	.leise {
		color: var(--m365-text-leise);
		font-size: 0.875rem;
	}
	.zeit-karte {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.zeit-auftrag {
		display: grid;
		gap: 0.4rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--ui-rand);
	}
	.zeit-auftrag-titel {
		margin: 0;
		display: grid;
		font-weight: 600;
	}
	.zeit-auftrag-titel small {
		font-weight: 400;
		color: var(--ui-text-leise);
	}
	.zeit-link {
		font-size: var(--ui-schrift-s);
	}
</style>
