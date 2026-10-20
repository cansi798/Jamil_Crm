<script lang="ts">
	import { untrack } from 'svelte';
	import { euro } from '$lib/geld';
	import { tagPlus } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type Zeile = PageData['zeilen'][number];
	type Spalte = 'name' | 'auftraege' | 'angebote' | 'angenommen' | 'quoteProzent' | 'umsatzCent' | 'durchschnittCent';

	let sortierung = $state<{ spalte: Spalte; ab: boolean }>(untrack(() => ({ spalte: data.mitPreisen ? 'umsatzCent' : 'auftraege', ab: true })));
	const sortiert = $derived(
		[...data.zeilen].sort((a, b) => {
			const x = a[sortierung.spalte] ?? -1;
			const y = b[sortierung.spalte] ?? -1;
			const v = typeof x === 'string' ? x.localeCompare(String(y), 'de') : (x as number) - (y as number);
			return sortierung.ab ? -v : v;
		})
	);
	const sortiere = (spalte: Spalte) =>
		(sortierung = { spalte, ab: sortierung.spalte === spalte ? !sortierung.ab : spalte !== 'name' });
	const pfeil = (spalte: Spalte) => (sortierung.spalte === spalte ? (sortierung.ab ? ' ▼' : ' ▲') : '');
	const aria = (spalte: Spalte) => (sortierung.spalte === spalte ? (sortierung.ab ? 'descending' : 'ascending') : 'none');

	// Ohne Umsatz im Zeitraum zeigt das Diagramm zuerst die Aufträge
	let balken = $state<'auftraege' | 'umsatzCent'>(
		untrack(() => (data.mitPreisen && data.zeilen.some((z) => (z.umsatzCent ?? 0) > 0) ? 'umsatzCent' : 'auftraege'))
	);
	const maxWert = $derived(Math.max(1, ...data.zeilen.map((z) => (z[balken] as number | null) ?? 0)));
	const summe = $derived({
		auftraege: data.zeilen.reduce((s, z) => s + z.auftraege, 0),
		angebote: data.zeilen.reduce((s, z) => s + z.angebote, 0),
		angenommen: data.zeilen.reduce((s, z) => s + z.angenommen, 0),
		umsatz: data.zeilen.reduce((s, z) => s + (z.umsatzCent ?? 0), 0)
	});
	const bis = $derived(data.bis);
	const vorschlaege = $derived([
		{ name: '30 Tage', von: tagPlus(bis, -30) },
		{ name: '3 Monate', von: tagPlus(bis, -91) },
		{ name: '12 Monate', von: tagPlus(bis, -365) },
		{ name: 'Dieses Jahr', von: `${bis.slice(0, 4)}-01-01` }
	]);
	const zahl = (z: Zeile, s: Spalte) => {
		const w = z[s];
		if (w === null || w === undefined) return '–';
		if (s === 'quoteProzent') return `${String(w).replace('.', ',')} %`;
		if (s === 'umsatzCent' || s === 'durchschnittCent') return euro(w as number);
		return String(w);
	};
</script>

<svelte:head>
	<title>Auswertung Quellen</title>
</svelte:head>

<main class="kd-seite breit qa-seite">
	<h1>Auswertung nach Quelle</h1>
	<p class="kd-info">
		Aufträge und Angebote, die im Zeitraum angelegt wurden. Umsatz = Summe der angenommenen Angebote (netto) – Rechnungen gibt es im CRM noch
		nicht. Ø Auftragswert = Umsatz je Auftrag mit angenommenem Angebot.
	</p>

	<form method="GET" class="qa-zeitraum">
		<label>Von <input type="date" name="von" value={data.von} /></label>
		<label>Bis <input type="date" name="bis" value={data.bis} /></label>
		<button type="submit" class="kd-knopf">Anzeigen</button>
		<span class="qa-vorschlaege">
			{#each vorschlaege as v (v.name)}<a class="kd-knopf hell klein" href={`?von=${v.von}&bis=${bis}`}>{v.name}</a>{/each}
		</span>
	</form>

	<section class="qa-balken" aria-label="Diagramm">
		<div class="qa-balken-kopf">
			<h2>{balken === 'umsatzCent' ? 'Umsatz' : 'Aufträge'} je Quelle</h2>
			{#if data.mitPreisen}
				<div role="group" aria-label="Diagramm zeigt">
					<button type="button" class="kd-knopf hell klein" aria-pressed={balken === 'umsatzCent'} onclick={() => (balken = 'umsatzCent')}>Umsatz</button>
					<button type="button" class="kd-knopf hell klein" aria-pressed={balken === 'auftraege'} onclick={() => (balken = 'auftraege')}>Aufträge</button>
				</div>
			{/if}
		</div>
		<ul>
			{#each sortiert as z (z.quelleId ?? 'ohne')}
				{@const w = (z[balken] as number | null) ?? 0}
				<li>
					<span class="qa-name">{z.name}</span>
					<span class="qa-spur"><span class="qa-wert" style:width={`${(w / maxWert) * 100}%`}></span></span>
					<span class="qa-zahl">{balken === 'umsatzCent' ? euro(w) : w}</span>
				</li>
			{/each}
		</ul>
	</section>

	<div class="qa-tabelle-huelle">
		<table class="qa-tabelle">
			<thead>
				<tr>
					{#each [['name', 'Quelle'], ['auftraege', 'Aufträge'], ['angebote', 'Angebote'], ['angenommen', 'Angenommen'], ['quoteProzent', 'Annahmequote'], ...(data.mitPreisen ? [['umsatzCent', 'Umsatz'], ['durchschnittCent', 'Ø Auftragswert']] : [])] as [s, t] (s)}
						<th scope="col" aria-sort={aria(s as Spalte)}>
							<button type="button" onclick={() => sortiere(s as Spalte)}>{t}{pfeil(s as Spalte)}</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each sortiert as z (z.quelleId ?? 'ohne')}
					<tr>
						<th scope="row">{#if z.quelleId}<a href={`/auftraege?ansicht=liste&quelle=${z.quelleId}`}>{z.name}</a>{:else}{z.name}{/if}</th>
						<td>{z.auftraege}</td>
						<td>{z.angebote}</td>
						<td>{z.angenommen}</td>
						<td>{zahl(z, 'quoteProzent')}</td>
						{#if data.mitPreisen}
							<td>{zahl(z, 'umsatzCent')}</td>
							<td>{zahl(z, 'durchschnittCent')}</td>
						{/if}
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<th scope="row">Summe</th>
					<td>{summe.auftraege}</td>
					<td>{summe.angebote}</td>
					<td>{summe.angenommen}</td>
					<td></td>
					{#if data.mitPreisen}<td>{euro(summe.umsatz)}</td><td></td>{/if}
				</tr>
			</tfoot>
		</table>
	</div>
</main>

<style>
	.qa-seite {
		max-width: 70rem;
	}
	.qa-zeitraum {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 0.75rem;
		margin: 1rem 0;
	}
	.qa-zeitraum label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.qa-zeitraum input {
		width: auto !important;
	}
	.qa-vorschlaege {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.qa-balken {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.qa-balken-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.qa-balken h2 {
		margin: 0;
		font-size: 1rem;
	}
	.qa-balken button[aria-pressed='true'] {
		background: var(--m365-primaer);
		color: #fff;
	}
	.qa-balken ul {
		list-style: none;
		margin: 0.75rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.qa-balken li {
		display: grid;
		grid-template-columns: minmax(6rem, 9rem) minmax(0, 1fr) minmax(4.5rem, auto);
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.qa-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qa-spur {
		height: 1rem;
		border-radius: 999px;
		background: var(--m365-flaeche-hover);
		overflow: hidden;
	}
	.qa-wert {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: 999px;
		background: var(--m365-primaer);
	}
	.qa-zahl {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.qa-tabelle-huelle {
		overflow-x: auto;
	}
	.qa-tabelle {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.qa-tabelle th,
	.qa-tabelle td {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--m365-rand);
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.qa-tabelle th[scope='row'],
	.qa-tabelle thead th:first-child {
		text-align: left;
	}
	.qa-tabelle thead button {
		border: 0;
		background: none;
		font: inherit;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		padding: 0;
	}
	.qa-tabelle tfoot th,
	.qa-tabelle tfoot td {
		font-weight: 600;
		border-bottom: 0;
	}
</style>
