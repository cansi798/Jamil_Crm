<script lang="ts">
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import KundeWahl from '$lib/components/ui/KundeWahl.svelte';
	import { goto } from '$app/navigation';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import HeuteListe from '$lib/components/HeuteListe.svelte';
	import ZeitKnoepfe from '$lib/components/zeit/ZeitKnoepfe.svelte';
	import { loesche, speichere } from '$lib/heute-kopie';
	import { tagKurz } from '$lib/zeit';
	import { kennzahlText } from '$lib/kennzahlen';
	import { euro } from '$lib/geld';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Kopie für schlechtes Netz (nur auf diesem Gerät, bis zum Abmelden bzw. bis morgen)
	$effect(() => {
		if (data.heute && data.benutzerId) speichere(data.benutzerId, data.heuteTag, data.heute, new Date());
		else loesche(); // kein Zugriff auf Einsätze → auch keine (alte) Kopie auf diesem Gerät
	});

	// Bereiche des Starts ein-/ausblenden (Jamil msg 2813) – je Benutzer auf diesem Gerät gemerkt
	const BEREICHE = [
		['zeit', 'Zeiterfassung'],
		['monat', 'Diesen Monat'],
		['heute', 'Heute'],
		['kennzahlen', 'Kennzahlen'],
		['handlung', 'Handlungsbedarf'],
		['auslastung', 'Auslastung (2 Wochen)'],
		['quellen', 'Umsatz nach Auftragsquelle'],
		['bereiche', 'Bereiche']
	] as const;
	type BereichId = (typeof BEREICHE)[number][0];
	const schluessel = $derived(`crm-start-ausgeblendet:${data.benutzerId ?? ''}`);
	let ausgeblendet = $state<string[]>([]);
	let anpassen = $state(false);
	$effect(() => {
		try {
			ausgeblendet = JSON.parse(localStorage.getItem(schluessel) ?? '[]');
		} catch {
			ausgeblendet = [];
		}
	});
	const zeigen = (id: BereichId) => !ausgeblendet.includes(id);
	function umschalten(id: BereichId, an: boolean) {
		ausgeblendet = an ? ausgeblendet.filter((x) => x !== id) : [...ausgeblendet, id];
		try {
			localStorage.setItem(schluessel, JSON.stringify(ausgeblendet));
		} catch {
			// privates Fenster o. Ä.: gilt nur bis zum Neuladen
		}
	}
	const prozentBreite = (p: number) => `${Math.min(100, Math.max(2, p))}%`;
	const maxUmsatz = $derived(Math.max(1, ...(data.cockpit?.quellen ?? []).map((q) => q.umsatzCent)));
	const bereiche = $derived((data.navigation?.haupt ?? []).filter((e) => e.symbol !== 'start'));
</script>

<svelte:head>
	<title>Start – CRM System</title>
</svelte:head>

<main class="start kd-seite breit">
	<header class="seiten-kopf">
		<div><h1>Start</h1></div>
		{#if data.darfKundeAnlegen}
			<div class="seiten-aktionen"><a href="/kunden/neu" class="kd-knopf">+ Kunde</a></div>
		{/if}
	</header>

	{#if data.kunden}
		<FilterLeiste form={false} label="Kunden suchen">
			{#snippet rechts()}
				<button type="button" class="knopf-ghost" aria-expanded={anpassen} onclick={() => (anpassen = !anpassen)}>Start anpassen</button>
			{/snippet}
			{#snippet suche()}
				<div class="suche">
					<KundeWahl label="Kunden suchen" placeholder="Kunden suchen – Name, Ort oder Telefon" onwaehle={(k) => goto(`/kunden/${k.id}`)} />
				</div>
			{/snippet}
		</FilterLeiste>
	{/if}

	{#if anpassen}
		<section class="st-anpassen" aria-label="Start anpassen">
			<p class="kd-info">Welche Bereiche sollen auf Ihrem Start erscheinen? (gilt für Sie auf diesem Gerät)</p>
			<div class="st-schalter">
				{#each BEREICHE as [id, text] (id)}
					<span onchange={(e) => umschalten(id, (e.target as HTMLInputElement).checked)}>
						<Schalter label={text} an={zeigen(id)} />
					</span>
				{/each}
			</div>
		</section>
	{/if}

	<div class="st-raster">
	{#if data.zeit && zeigen('zeit')}
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

	{#if data.monat && zeigen('monat')}
		<a href={data.monat.link} class="heute-karte monat-kachel" class:erreicht={data.monat.erreicht} aria-label={`Diesen Monat: ${data.monat.satz} – Auslastung öffnen`}>
			<span class="monat-titel">Diesen Monat</span>
			<span class="monat-satz">{data.monat.satz}</span>
			{#if data.monat.kalkulationFehlt}<small>Kalkulation unvollständig – Kosten und freie Stunden fehlen.</small>{/if}
		</a>
	{/if}

	{#if data.plan && zeigen('heute')}
		<section aria-labelledby="heute-titel" class="heute-karte plan">
			<div class="plan-kopf">
				<h2 id="heute-titel">Heute <small>{tagKurz(data.heuteTag)}</small></h2>
				{#if data.personen.length > 0}
					<form method="GET" class="plan-person">
						<PersonWahl
							name="person"
							label="Person"
							klein
							required
							personen={data.personen.map((p) => ({ id: p.id, name: p.id === data.benutzerId ? `Ich (${p.name})` : p.name }))}
							wert={data.plan.person.id}
							absenden
						/>
						<noscript><button type="submit" class="kd-knopf hell">Zeigen</button></noscript>
					</form>
				{/if}
			</div>
			<p class="plan-text">{data.plan.text}</p>
			{#each [{ titel: 'Termine', liste: data.plan.termine }, { titel: 'Aufgaben', liste: data.plan.todos }, { titel: 'Nachfassen', liste: data.plan.nachfassen }] as ab (ab.titel)}
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
	{:else if data.heute && zeigen('heute')}
		<section aria-labelledby="heute-titel" class="heute-karte">
			<h2 id="heute-titel">Meine Einsätze heute <small>{tagKurz(data.heuteTag)}</small></h2>
			<HeuteListe einsaetze={data.heute} />
		</section>
	{/if}


	{#if data.cockpit}
		{#if zeigen('kennzahlen')}
			<section class="heute-karte st-kennzahlen" aria-labelledby="st-kz">
				<div class="plan-kopf"><h2 id="st-kz">Kennzahlen <small>Dieser Monat</small></h2></div>
				<ul class="st-kz-liste">
					{#each data.cockpit.kennzahlen as kz (kz.id)}
						<li class={`st-kz ampel-${kz.ampel ?? 'keine'}`} title={kz.info.formel}>
							<span class="st-kz-titel">{kz.info.titel}</span>
							<strong>{kz.fehlt ? '–' : kennzahlText(kz.info.einheit, kz.wert)}</strong>
							<small>{kz.fehlt ?? kz.ampelText ?? kz.info.richtwert ?? ''}</small>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if zeigen('handlung')}
			<section class="heute-karte" aria-labelledby="st-hb">
				<div class="plan-kopf"><h2 id="st-hb">Handlungsbedarf</h2></div>
				<ul class="st-handlung">
					{#each data.cockpit.handlung as h (h.id)}
						<li>
							<a href={h.href} class={`st-h ton-${h.ton}`} class:null={h.anzahl === 0}>
								<strong>{h.anzahl}</strong><span>{h.titel}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if zeigen('auslastung')}
			<section class="heute-karte" aria-labelledby="st-al">
				<div class="plan-kopf">
					<h2 id="st-al">Auslastung <small>nächste 2 Wochen</small></h2>
					<a href="/plantafel?ansicht=team" class="zeit-link">Plantafel</a>
				</div>
				<ul class="st-balken">
					{#each data.cockpit.auslastung.zeilen as z (z.id)}
						<li>
							<span class="st-name">{z.name}</span>
							<span class="st-bahn" aria-hidden="true"><span class:voll={z.prozent > 100} style:width={prozentBreite(z.prozent)}></span></span>
							<span class="st-wert">{z.prozent} %</span>
						</li>
					{:else}
						<li class="kd-info">Keine aktiven Mitarbeiter.</li>
					{/each}
				</ul>
				<p class="kd-info">Geplante Einsätze gegen Mo–Fr × 8 h, Abwesenheiten abgezogen.</p>
			</section>
		{/if}
		{#if data.cockpit.quellen && zeigen('quellen')}
			<section class="heute-karte" aria-labelledby="st-q">
				<div class="plan-kopf">
					<h2 id="st-q">Umsatz nach Auftragsquelle <small>dieses Jahr</small></h2>
					<a href="/auswertung/quellen" class="zeit-link">Auswertung</a>
				</div>
				<ul class="st-balken">
					{#each data.cockpit.quellen as q (q.name)}
						<li>
							<span class="st-name">{q.name}</span>
							<span class="st-bahn" aria-hidden="true"><span style:width={prozentBreite((q.umsatzCent / maxUmsatz) * 100)}></span></span>
							<span class="st-wert">{euro(q.umsatzCent)}</span>
						</li>
					{:else}
						<li class="kd-info">Noch keine Aufträge mit Quelle in diesem Jahr.</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
	</div>

	{#if bereiche.length > 0 && zeigen('bereiche')}
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
	{:else if bereiche.length === 0}
		<p class="leise">Für Ihr Konto sind noch keine Bereiche freigeschaltet.</p>
	{/if}
</main>

<style>
	.bereiche-titel {
		font-size: 1rem;
		font-weight: 600;
		margin: 1.5rem 0 0.75rem;
		color: var(--m365-text);
	}

	/* Start-Cockpit: Karten im Raster (zwei Spalten ab 1100 px) */
	.st-raster {
		display: grid;
		gap: var(--ui-abstand-block);
		align-items: start;
	}
	.st-raster > :global(*) {
		margin: 0 !important;
	}
	@media (min-width: 1100px) {
		.st-raster {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.st-kennzahlen {
			grid-column: 1 / -1;
		}
	}
	.st-anpassen {
		margin: 0 0 var(--ui-abstand-block);
		padding: var(--ui-karte-y) var(--ui-karte-x);
		border: 1px dashed var(--ui-akzent-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-akzent-zart);
	}
	.st-anpassen .kd-info {
		margin: 0 0 0.4rem;
	}
	.st-schalter {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.5rem;
	}
	.st-kz-liste {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 9rem), 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.st-kz {
		display: grid;
		gap: 0.1rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--ui-rand);
		border-left: 4px solid var(--ui-grau);
		border-radius: var(--ui-radius);
	}
	.st-kz.ampel-gruen { border-left-color: var(--ui-gruen); }
	.st-kz.ampel-gelb { border-left-color: var(--ui-orange); }
	.st-kz.ampel-rot { border-left-color: var(--ui-rot); }
	.st-kz-titel {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
		font-weight: 600;
	}
	.st-kz strong {
		font-family: var(--ui-schrift-titel);
		font-size: 1.25rem;
	}
	.st-kz small {
		color: var(--ui-text-leise);
		font-size: 0.6875rem;
		line-height: 1.3;
	}
	.st-handlung {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 8rem), 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.st-h {
		display: grid;
		gap: 0.1rem;
		padding: 0.6rem 0.75rem;
		border-radius: var(--ui-radius);
		background: var(--ui-band);
		border-left: 4px solid var(--st-ton);
		color: var(--ui-text);
		text-decoration: none;
	}
	.st-h:hover {
		background: var(--ui-akzent-zart);
	}
	.st-h strong {
		font-family: var(--ui-schrift-titel);
		font-size: 1.375rem;
	}
	.st-h span {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.st-h.null {
		opacity: 0.55;
	}
	.ton-rot { --st-ton: var(--ui-rot); }
	.ton-orange { --st-ton: var(--ui-orange); }
	.ton-blau { --st-ton: var(--ui-blau); }
	.ton-grau { --st-ton: var(--ui-grau); }
	.st-balken {
		display: grid;
		gap: 0.4rem;
		margin: 0 0 0.4rem;
		padding: 0;
		list-style: none;
	}
	.st-balken li {
		display: grid;
		grid-template-columns: minmax(6rem, 30%) minmax(0, 1fr) 4.5rem;
		align-items: center;
		gap: 0.6rem;
		font-size: var(--ui-schrift-s);
	}
	.st-name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.st-bahn {
		height: 0.6rem;
		border-radius: 999px;
		background: var(--ui-grau-hell);
		overflow: hidden;
	}
	.st-bahn span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--ui-akzent);
	}
	.st-bahn span.voll {
		background: var(--ui-rot);
	}
	.st-wert {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	/* Suche wie M365-CommandBar */
	.suche {
		flex: 1 1 18rem;
		max-width: 32rem;
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
		color: var(--ui-akzent-text);
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
