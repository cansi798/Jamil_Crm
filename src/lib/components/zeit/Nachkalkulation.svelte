<script lang="ts">
	import { euro } from '$lib/geld';
	import type { Nachkalkulation } from '$lib/nachkalkulation';

	/** Plan/Ist eines Auftrags mit Ampel (nur mit „Preise sehen“ geladen). */
	let { nk }: { nk: Nachkalkulation } = $props();
	const AMPEL = { rot: ['Verlust', 'rot'], gelb: ['deckt die Kosten', 'gelb'], gruen: ['mit Gewinn', 'gruen'] } as const;
	const geld = (c: number | null) => (c === null ? '–' : euro(c));
	const std = (h: number) => `${String(h).replace('.', ',')} h`;
</script>

<div class="nk">
	{#if nk.ampel}
		<p class={`nk-ampel ${AMPEL[nk.ampel][1]}`} data-testid="nk-ampel"><span class="nk-punkt" aria-hidden="true"></span>{AMPEL[nk.ampel][0]}
			{#if nk.ist.effektiverSatzCent !== null}<small>· {euro(nk.ist.effektiverSatzCent)} je Stunde</small>{/if}</p>
	{/if}
	<div class="nk-huelle">
		<table class="nk-tabelle">
			<thead><tr><th></th><th>Plan</th><th>Ist</th></tr></thead>
			<tbody>
				<tr><th scope="row">Arbeitsstunden</th><td>{std(nk.plan.stunden)}</td><td>{std(nk.ist.stunden)}{#if nk.stundenAbweichungProzent !== null} <small class:schlecht={nk.stundenAbweichungProzent > 10}>({nk.stundenAbweichungProzent > 0 ? '+' : ''}{nk.stundenAbweichungProzent} %)</small>{/if}</td></tr>
				<tr><th scope="row">Fahrt</th><td>–</td><td>{std(nk.ist.fahrtStunden)} · {String(nk.ist.km).replace('.', ',')} km · {geld(nk.ist.fahrtkostenCent)}</td></tr>
				<tr><th scope="row">Material</th><td>{geld(nk.plan.materialCent)}</td><td>{geld(nk.ist.materialCent)}{#if nk.ist.materialGeschaetzt} <small>(Plan)</small>{/if}</td></tr>
				{#if nk.ist.fremdCent > 0}<tr><th scope="row">Fremdleistungen</th><td>–</td><td>{geld(nk.ist.fremdCent)}</td></tr>{/if}
				<tr><th scope="row">Lohnkosten</th><td>{geld(nk.plan.lohnkostenCent)}</td><td>{geld(nk.ist.lohnkostenCent)}</td></tr>
				<tr><th scope="row">Kosten gesamt</th><td>{geld(nk.plan.kostenCent)}</td><td>{geld(nk.ist.kostenCent)}</td></tr>
				<tr><th scope="row">Erlös (netto)</th><td>{geld(nk.plan.erloesCent)}</td><td>{geld(nk.ist.erloesCent)}</td></tr>
				<tr><th scope="row">Deckungsbeitrag</th><td>{geld(nk.plan.deckungsbeitragCent)}</td><td>{geld(nk.ist.deckungsbeitragCent)}</td></tr>
				<tr class="nk-summe"><th scope="row">Gewinn</th><td class:schlecht={(nk.plan.gewinnCent ?? 0) < 0}>{geld(nk.plan.gewinnCent)}</td><td class:schlecht={(nk.ist.gewinnCent ?? 0) < 0} data-testid="nk-gewinn">{geld(nk.ist.gewinnCent)}</td></tr>
			</tbody>
		</table>
	</div>
	{#each nk.hinweise as h (h)}<p class="nk-hinweis">{h}</p>{/each}
</div>

<style>
	.nk { display: grid; gap: var(--ui-a2); }
	.nk-ampel { display: inline-flex; align-items: center; gap: var(--ui-a2); margin: 0; padding: var(--ui-a1) var(--ui-a3); border-radius: var(--ui-chip-radius); font-weight: 600; width: fit-content; }
	.nk-ampel small { font-weight: 400; }
	.nk-punkt { width: 0.7rem; height: 0.7rem; border-radius: 50%; }
	.rot { background: var(--ui-rot-hell); }
	.rot .nk-punkt { background: var(--ui-rot); }
	.gelb { background: var(--ui-orange-hell); }
	.gelb .nk-punkt { background: var(--ui-orange); }
	.gruen { background: var(--ui-gruen-hell); }
	.gruen .nk-punkt { background: var(--ui-gruen); }
	.nk-huelle { overflow-x: auto; }
	.nk-tabelle { width: 100%; border-collapse: collapse; font-size: var(--ui-schrift-m); }
	.nk-tabelle th, .nk-tabelle td { padding: var(--ui-a1) var(--ui-a2); text-align: right; border-bottom: 1px solid var(--ui-rand); }
	.nk-tabelle th[scope='row'] { text-align: left; font-weight: 500; }
	.nk-tabelle thead th { font-size: var(--ui-schrift-s); color: var(--ui-text-leise); }
	.nk-summe th, .nk-summe td { font-weight: 700; }
	.schlecht { color: var(--ui-gefahr); }
	small { color: var(--ui-text-leise); }
	small.schlecht { color: var(--ui-gefahr); }
	.nk-hinweis { margin: 0; font-size: var(--ui-schrift-s); color: var(--ui-text-leise); }
</style>
