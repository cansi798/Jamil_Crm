<script lang="ts">
	import '$lib/stil/kunden.css';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const a = $derived(data.a);
	const AMPEL: Record<string, string> = { rot: 'Verlust', gelb: 'deckt Kosten', gruen: 'Gewinn' };
	const geld = (c: number | null) => (c === null ? '–' : euro(c));
	const h = (x: number) => `${String(x).replace('.', ',')} h`;
	const STATUS: Record<string, string> = { anfrage: 'Anfrage', angebot: 'Angebot', beauftragt: 'Beauftragt', in_arbeit: 'In Arbeit', abgenommen: 'Abgenommen', abgerechnet: 'Abgerechnet' };
</script>

<svelte:head><title>Nachkalkulation – Auswertung</title></svelte:head>

<main class="kd-seite breit nkw">
	<header class="seiten-kopf">
		<div>
			<h1>Nachkalkulation</h1>
			<p class="seiten-meta">Plan gegen Ist · Aufträge mit erfasster Zeit vom {tagDeutsch(a.von)} bis {tagDeutsch(a.bis)}</p>
		</div>
	</header>
	<form method="GET" class="nkw-filter">
		<label>Von <input type="date" name="von" value={a.von} /></label>
		<label>Bis <input type="date" name="bis" value={a.bis} /></label>
		<label>Gruppieren nach
			<select name="gruppe">
				{#each Object.entries(data.gruppen) as [w, n] (w)}<option value={w} selected={w === a.gruppe}>{n}</option>{/each}
			</select>
		</label>
		<button type="submit" class="kd-knopf">Anzeigen</button>
	</form>
	{#if !a.satz}<p class="kd-fehler">Die Kalkulation ergibt noch keinen Kosten-Stundensatz – bitte zuerst unter „Kalkulation“ ausfüllen.</p>{/if}
	{#if a.kmSatzCent === null}<p class="kd-info">Tipp: In der Kalkulation „Kosten je km“ eintragen, dann zählen die Kilometer mit.</p>{/if}

	<Abschnitt titel={`Nach ${data.gruppen[a.gruppe]}`} anzahl={a.zeilen.length}>
		<div class="nkw-huelle">
			<table class="nkw-tabelle">
				<thead><tr><th>{data.gruppen[a.gruppe]}</th><th>Aufträge</th><th>Std. Plan</th><th>Std. Ist</th><th>Erlös</th><th>Kosten Ist</th><th>Gewinn Plan</th><th>Gewinn Ist</th><th>Ampel</th></tr></thead>
				<tbody>
					{#each a.zeilen as z (z.schluessel)}
						<tr>
							<th scope="row">{z.name}</th><td>{z.auftraege}</td><td>{h(z.planStunden)}</td><td>{h(z.istStunden)}</td>
							<td>{geld(z.erloesCent)}</td><td>{geld(z.istKostenCent)}</td><td>{geld(z.planGewinnCent)}</td>
							<td class:schlecht={(z.istGewinnCent ?? 0) < 0}>{geld(z.istGewinnCent)}</td>
							<td>{#if z.ampel}<span class={`nkw-ampel ${z.ampel}`}>{AMPEL[z.ampel]}</span>{:else}–{/if}</td>
						</tr>
					{:else}
						<tr><td colspan="9" class="kd-leer">Keine Aufträge mit erfasster Zeit in diesem Zeitraum.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if a.gruppe === 'leistung'}<p class="kd-info">Ist-Stunden und -Kosten je Leistung sind anteilig nach den geplanten Minuten verteilt.</p>{/if}
	</Abschnitt>

	<Abschnitt titel="Aufträge" anzahl={a.auftraege.length}>
		<ul class="nkw-auftraege">
			{#each a.auftraege as x (x.id)}
				<li>
					<a href={`/auftraege/${x.id}#nachkalkulation`}>{x.nummer} · {x.titel}</a> <small>{x.kundeName} · {STATUS[x.status] ?? x.status}</small>
					<span class="nkw-zahlen">{h(x.nk.plan.stunden)} → {h(x.nk.ist.stunden)} · Gewinn <strong class:schlecht={(x.nk.ist.gewinnCent ?? 0) < 0}>{geld(x.nk.ist.gewinnCent)}</strong>
						{#if x.nk.ampel}<span class={`nkw-ampel ${x.nk.ampel}`}>{AMPEL[x.nk.ampel]}</span>{/if}</span>
				</li>
			{/each}
		</ul>
	</Abschnitt>


	<Abschnitt titel="Lernen: Minuten pro Einheit">
		{#if form?.lernFehler}<p role="alert" class="kd-fehler">{form.lernFehler}</p>{/if}
		{#if form?.meldung}<p role="status" class="kd-info">{form.meldung}</p>{/if}
		{#if a.lernen.length === 0}
			<p class="kd-info">Noch keine Vorschläge. Sie entstehen aus abgenommenen Aufträgen mit erfasster Zeit (je Position mindestens 3 Aufträge und mehr als 10 % Abweichung).</p>
		{:else}
			<ul class="nkw-lernen">
				{#each a.lernen as v (v.katalogPositionId)}
					<li>
						<span><strong>{v.bezeichnung}</strong> ({v.einheit}): heute {String(v.aktuellMin).replace('.', ',')} Min. → gemessen <strong>{String(v.vorschlagMin).replace('.', ',')} Min.</strong>
							<small>(n = {v.n}, Streuung ± {String(v.streuungMin).replace('.', ',')} Min., {String(v.minMin).replace('.', ',')}–{String(v.maxMin).replace('.', ',')}; {v.abweichungProzent > 0 ? '+' : ''}{v.abweichungProzent} %)</small></span>
						{#if data.darfKatalog}
							<form method="POST" action="?/uebernehmen" use:enhance>
								<input type="hidden" name="id" value={v.katalogPositionId} /><input type="hidden" name="minuten" value={v.vorschlagMin} />
								<button type="submit" class="kd-knopf hell">Übernehmen</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="kd-info">Die Ist-Zeit eines Auftrags wird anteilig nach den geplanten Minuten auf seine Positionen verteilt. Nichts wird automatisch geändert.</p>
		{/if}
	</Abschnitt>
</main>

<style>
	.nkw-filter { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: flex-end; margin-bottom: var(--ui-a4); }
	.nkw-filter label { display: grid; gap: var(--ui-a1); font-size: var(--ui-schrift-s); }
	.nkw-huelle { overflow-x: auto; }
	.nkw-tabelle { width: 100%; border-collapse: collapse; font-size: var(--ui-schrift-m); }
	.nkw-tabelle th, .nkw-tabelle td { padding: var(--ui-a2); text-align: right; border-bottom: 1px solid var(--ui-rand); white-space: nowrap; }
	.nkw-tabelle th[scope='row'], .nkw-tabelle thead th:first-child { text-align: left; }
	.schlecht { color: var(--ui-gefahr); }
	.nkw-ampel { display: inline-block; padding: 0 var(--ui-a2); border-radius: var(--ui-chip-radius); font-size: var(--ui-schrift-xs); font-weight: 600; }
	.nkw-ampel.rot { background: var(--ui-rot-hell); color: var(--ui-rot); }
	.nkw-ampel.gelb { background: var(--ui-orange-hell); color: #8a5300; }
	.nkw-ampel.gruen { background: var(--ui-gruen-hell); color: var(--ui-gruen); }
	.nkw-auftraege, .nkw-lernen { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-a2); }
	.nkw-auftraege li, .nkw-lernen li { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: center; padding-bottom: var(--ui-a2); border-bottom: 1px solid var(--ui-rand); }
	.nkw-zahlen { margin-left: auto; font-size: var(--ui-schrift-s); }
	small { color: var(--ui-text-leise); }
</style>
