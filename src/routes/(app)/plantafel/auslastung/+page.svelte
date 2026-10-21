<script lang="ts">
	import { euro } from '$lib/geld';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const stunden = (h: number | null) => (h === null ? '–' : `${String(h).replace('.', ',')} h`);
	const prozent = (p: number | null) => (p === null ? '–' : `${p} %`);
	const stufe = (p: number | null) => (p === null ? '' : p > 100 ? 'ueber' : p >= 80 ? 'gut' : p >= 50 ? 'mittel' : 'wenig');
</script>

<svelte:head>
	<title>Auslastung</title>
</svelte:head>

<main class="kd-seite breit al-seite">
	<a href="/plantafel" class="kd-zurueck">← Plantafel</a>
	<h1 class="titel-bleibt">Auslastung {data.monatText}</h1>
	<nav class="al-monate" aria-label="Monat wählen">
		<a class="kd-knopf hell klein" href={`?monat=${data.vorher}`}>← Vormonat</a>
		<a class="kd-knopf hell klein" href="?">Dieser Monat</a>
		<a class="kd-knopf hell klein" href={`?monat=${data.nachher}`}>Nächster Monat →</a>
	</nav>
	<p class="kd-info">
		Verfügbar = produktive Stunden aus der Kalkulation, anteilig nach Werktagen im Monat (Urlaub und Krankheit sind dort schon abgezogen).
		Geplant = Termine auf der Plantafel.
	</p>

	{#if data.kalkulationFehlt}
		<p class="al-warnung" role="status">
			In der Kalkulation sind noch keine Mitarbeiter erfasst – darum fehlen die verfügbaren Stunden{data.mitGeld ? ' und die Monatskosten' : ''}.
			{#if data.darfKalkulation}<a href="/kalkulation">Kalkulation öffnen</a>{/if}
		</p>
	{/if}

	{#if data.geld}
		{@const g = data.geld}
		<section class="al-be" class:erreicht={g.erreicht} aria-labelledby="be-titel">
			<h2 id="be-titel">Break-even {data.monatText}: {g.erreicht ? 'erreicht' : 'noch nicht erreicht'}</h2>
			<p class="al-be-zahl">
				{#if g.erreicht}{euro(g.ergebnisCent)} Gewinn verplant{:else}Es fehlen noch {euro(-g.ergebnisCent)}{/if}
			</p>
			<div class="al-spur" role="img" aria-label={`Kosten zu ${g.deckungProzent ?? 0} % gedeckt`}>
				<span class="al-wert" style:width={`${Math.min(100, g.deckungProzent ?? 0)}%`}></span>
			</div>
			<dl class="al-be-liste">
				<div><dt>Verplanter Umsatz</dt><dd>{euro(g.umsatzCent)}</dd></div>
				<div><dt>− Material</dt><dd>{euro(g.materialCent)}</dd></div>
				<div><dt>− Monatskosten (Kalkulation)</dt><dd>{euro(g.kostenCent)}</dd></div>
				<div class="al-summe"><dt>= Ergebnis</dt><dd>{euro(g.ergebnisCent)}</dd></div>
			</dl>
			<p class="kd-info">
				Umsatz = angenommene Angebote, anteilig nach den Terminstunden ihres Auftrags in diesem Monat ({g.auftraegeImMonat}
				{g.auftraegeImMonat === 1 ? 'Auftrag' : 'Aufträge'}). Rechnungen gibt es im CRM noch nicht.
				{#if g.nichtEingeplantCent > 0}Noch ohne Termin: {euro(g.nichtEingeplantCent)} aus angenommenen Angeboten.{/if}
			</p>
		</section>
	{/if}

	<div class="al-tabelle-huelle">
		<table class="al-tabelle" aria-label="Auslastung je Mitarbeiter">
			<thead>
				<tr><th scope="col">Mitarbeiter</th><th scope="col">Verfügbar</th><th scope="col">Geplant</th><th scope="col">Auslastung</th><th scope="col">Frei</th></tr>
			</thead>
			<tbody>
				{#each data.personen as p, i (p.benutzerId ?? `k${i}`)}
					<tr>
						<th scope="row">
							{p.name}
							{#if p.hinweis}<small class="al-hinweis">{p.hinweis}</small>{/if}
						</th>
						<td>{stunden(p.verfuegbar)}</td>
						<td>{stunden(p.geplant)}</td>
						<td>
							<span class={`al-prozent ${stufe(p.auslastungProzent)}`}>{prozent(p.auslastungProzent)}</span>
							{#if p.ueberbucht}<small class="al-hinweis">überbucht</small>{/if}
						</td>
						<td>{stunden(p.frei)}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="kd-leer">Keine Mitarbeiter und keine Termine in diesem Monat.</td></tr>
				{/each}
			</tbody>
			{#if data.personen.length > 0}
				<tfoot>
					<tr>
						<th scope="row">Summe</th>
						<td>{stunden(data.summe.verfuegbar)}</td>
						<td>{stunden(data.summe.geplant)}</td>
						<td><span class={`al-prozent ${stufe(data.summe.auslastungProzent)}`}>{prozent(data.summe.auslastungProzent)}</span></td>
						<td>{stunden(data.summe.frei)}</td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
</main>

<style>
	.al-seite {
		max-width: none; /* ganze Arbeitsfläche (Jamil msg 2838) */
	}
	.al-warnung {
		padding: 0.6rem 0.8rem;
		border-radius: var(--m365-radius);
		background: #fff4ce;
		color: #4d3a00;
	}
	.al-monate {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.5rem 0 1rem;
	}
	.al-be {
		margin: 1rem 0;
		padding: 0.85rem 1rem;
		border: 1px solid var(--m365-rand);
		border-left: 6px solid #c50f1f;
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.al-be.erreicht {
		border-left-color: #107c10;
	}
	.al-be h2 {
		margin: 0;
		font-size: 1rem;
	}
	.al-be-zahl {
		margin: 0.35rem 0 0.6rem;
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.al-spur {
		height: 0.8rem;
		border-radius: 999px;
		background: var(--m365-flaeche-hover);
		overflow: hidden;
	}
	.al-wert {
		display: block;
		height: 100%;
		background: #c50f1f;
	}
	.al-be.erreicht .al-wert {
		background: #107c10;
	}
	.al-be-liste {
		display: grid;
		gap: 0.2rem;
		margin: 0.75rem 0 0.5rem;
		max-width: 26rem;
	}
	.al-be-liste div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.al-be-liste dt {
		font-weight: 400;
	}
	.al-be-liste dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.al-summe {
		border-top: 1px solid var(--m365-rand);
		padding-top: 0.2rem;
		font-weight: 700;
	}
	.al-tabelle-huelle {
		overflow-x: auto;
	}
	.al-tabelle {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.al-tabelle th,
	.al-tabelle td {
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--m365-rand);
		text-align: right;
		font-variant-numeric: tabular-nums;
		vertical-align: top;
	}
	.al-tabelle th[scope='row'],
	.al-tabelle thead th:first-child {
		text-align: left;
	}
	.al-tabelle tfoot th,
	.al-tabelle tfoot td {
		font-weight: 600;
		border-bottom: 0;
	}
	.al-hinweis {
		display: block;
		font-weight: 400;
		color: var(--m365-text-leise, #616161);
		white-space: normal;
		max-width: 22rem;
	}
	.al-prozent {
		display: inline-block;
		min-width: 3.2rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		text-align: center;
		font-weight: 600;
	}
	.al-prozent.wenig {
		background: #fde7e9;
		color: #a4262c;
	}
	.al-prozent.mittel {
		background: #fff4ce;
		color: #7a5b00;
	}
	.al-prozent.gut {
		background: #dff6dd;
		color: #0e700e;
	}
	.al-prozent.ueber {
		background: #e8e3f9;
		color: #5c2e91;
	}
</style>
