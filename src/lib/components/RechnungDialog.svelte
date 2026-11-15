<script lang="ts">
	import { enhance } from '$app/forms';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { euro, mengeText } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import { schlussBetrag } from '$lib/rechnungen';

	/**
	 * Dialog „Rechnung erstellen“ am Auftrag (Lexware Phase 3): Positionen aus dem angenommenen Angebot, Mengen laut
	 * Aufmaß (Haken weg = Teilrechnung), Leistungszeitraum, Zahlungsziel, optional gleich festschreiben. Abschlag
	 * (Prozent oder Betrag) und Schluss werden nur vorbereitet („In Lexware fertigstellen“).
	 */
	type Vorschlag = {
		angebot: { id: string; nummer: string } | null;
		ab: { nummer: string } | null;
		positionen: { bezeichnung: string; menge: number; einheit: string; einzelpreisCent: number; bisherMenge: number }[];
		mwstSatz: number;
		leistungVon: string;
		leistungBis: string;
		zahlungszielTage: number;
		gesamtBruttoCent: number;
		abschlaege: { nummer: string | null; bruttoCent: number; storniert: boolean }[];
		wartet: boolean;
		grund: string | null;
	};
	let { v, fehler, schliessen }: { v: Vorschlag; fehler?: string | null; schliessen?: () => void } = $props();
	let art = $state<'rechnung' | 'abschlag' | 'schluss'>('rechnung');
	const rest = $derived(schlussBetrag(v.gesamtBruttoCent, v.abschlaege));
</script>

{#if v.grund}
	<p class="kd-info" data-testid="rechnung-grund">{v.grund}</p>
{:else if v.wartet}
	<p class="kd-info">Eine Rechnung wird gerade in Lexware angelegt – bitte kurz warten.</p>
{:else}
	<form method="POST" action="?/rechnungErstellen" use:enhance class="kd-formular" data-testid="rechnung-dialog">
		{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
		<p class="kd-info">
			Aus {v.ab ? `der Auftragsbestätigung ${v.ab.nummer}` : `dem Angebot ${v.angebot?.nummer}`} – Lexware vergibt Nummer und PDF. <InfoFenster id="rechnung.dialog" />
		</p>
		<div class="af-wege" role="group" aria-label="Rechnungsart">
			{#each [['rechnung', 'Rechnung / Teilrechnung'], ['abschlag', 'Abschlag'], ['schluss', 'Schlussrechnung']] as [w, t] (w)}
				<button type="button" class="pill" class:aktiv={art === w} aria-pressed={art === w} onclick={() => (art = w as typeof art)}>{t}</button>
			{/each}
		</div>
		<input type="hidden" name="art" value={art} />
		{#if art !== 'abschlag'}
			<input type="hidden" name="anzahl" value={v.positionen.length} />
			<table class="rd-tabelle">
				<thead><tr><th></th><th>Position</th><th>Angebot</th><th>Menge laut Aufmaß</th></tr></thead>
				<tbody>
					{#each v.positionen as p, i (i)}
						<tr>
							<td><input type="checkbox" name={`aktiv-${i}`} checked aria-label={`${p.bezeichnung} abrechnen`} /></td>
							<td>{p.bezeichnung}<br /><small class="kd-info">{euro(p.einzelpreisCent)} / {p.einheit}{p.bisherMenge > 0 ? ` · schon abgerechnet ${mengeText(p.bisherMenge)}` : ''}</small></td>
							<td>{mengeText(p.menge)} {p.einheit}</td>
							<td><input type="text" inputmode="decimal" name={`menge-${i}`} value={mengeText(p.menge)} size="7" aria-label={`Menge ${p.bezeichnung}`} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		{#if art === 'abschlag'}
			<div class="nf-raster">
				<label>Abschlag in % vom Auftrag ({euro(v.gesamtBruttoCent)})<input type="text" inputmode="decimal" name="abschlagProzent" placeholder="z. B. 30" /></label>
				<label>oder Betrag brutto<input type="text" inputmode="decimal" name="abschlagBetrag" placeholder="z. B. 3.000,00" /></label>
			</div>
			<p class="kd-info">Wird vorbereitet – die Abschlagsrechnung legen Sie mit „In Lexware fertigstellen“ in Lexware an. <InfoFenster id="rechnung.abschlag" /></p>
		{:else if art === 'schluss'}
			<p class="kd-info">
				Bisherige Abschläge: {v.abschlaege.length === 0 ? 'keine' : v.abschlaege.map((x) => `${x.nummer ?? '–'} ${euro(x.bruttoCent)}`).join(', ')}.
				Rest laut Angebot: {euro(rest.restCent)} (mit geänderten Mengen neu berechnet). Wird vorbereitet, angelegt wird in Lexware.
			</p>
		{/if}
		<div class="nf-raster">
			<label>Leistung von<input type="date" name="leistungVon" value={v.leistungVon} required /></label>
			<label>Leistung bis<input type="date" name="leistungBis" value={v.leistungBis} required /></label>
			<label>Zahlungsziel (Tage)<input type="number" name="zahlungszielTage" min="0" max="120" value={v.zahlungszielTage} /></label>
		</div>
		{#if art === 'rechnung'}
			<label class="kd-haken"><input type="checkbox" name="festschreiben" value="ja" /><span>Gleich festschreiben (sonst Entwurf zum Prüfen in Lexware)</span></label>
		{/if}
		<p class="kd-info">Leistungszeitraum {tagDeutsch(v.leistungVon)} – {tagDeutsch(v.leistungBis)} vorgeschlagen aus Baubeginn und Einsätzen.</p>
		<div class="af-fuss">
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
			<button type="submit" class="kd-knopf">{art === 'rechnung' ? 'Rechnung in Lexware anlegen' : 'Vorbereiten'}</button>
		</div>
	</form>
{/if}

<style>
	.rd-tabelle {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	.rd-tabelle th,
	.rd-tabelle td {
		text-align: left;
		padding: 0.35rem 0.4rem;
		border-bottom: 1px solid var(--m365-rand, #ddd);
		vertical-align: top;
	}
	@media (max-width: 600px) {
		.rd-tabelle th:nth-child(3),
		.rd-tabelle td:nth-child(3) {
			display: none;
		}
	}
</style>
