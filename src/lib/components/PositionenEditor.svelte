<script module lang="ts">
	/** Eine Zeile im Editor – Eingaben als Text (Komma-Eingabe), geprüft und gerechnet wird beim Anzeigen/Speichern. */
	export type EditorZeile = {
		schluessel: number;
		katalogPositionId: string | null;
		bezeichnung: string;
		beschreibung: string;
		menge: string;
		einheit: string;
		einzelpreis: string;
		/** Arbeitszeit je Einheit in Minuten (Text; leer = unbekannt, bei „h“ 60) – nur im Angebot. */
		arbeitMinuten?: string;
		/** Materialanteil je Einheit aus dem Katalog (für die Ampel). */
		materialCent?: number | null;
	};

	let zaehler = 0;
	export const neuerSchluessel = () => ++zaehler;
</script>

<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { euro, leseEuroInCent, leseMenge, positionsSumme } from '$lib/geld';
	import { EINHEITEN } from '$lib/katalog-werte';
	import { istKiPruefen } from '$lib/ki-entwurf';

	/**
	 * Positionen eines Angebots: als Karten (Handy) bzw. Tabelle (ab 700 px). Menge und Einzelpreis direkt editierbar
	 * (Komma-Eingabe), Verschieben mit Knöpfen hoch/runter, Entfernen. Die Gesamtsumme je Zeile rechnet live mit
	 * denselben Funktionen wie der Server (`src/lib/geld.ts`); verbindlich ist die Rechnung beim Speichern.
	 *
	 * `katalogPreisFest` (Angebots-Vorlagen): Bei Katalogpositionen ist der Preis nicht änderbar – er kommt beim Einfügen
	 * ins Angebot aus dem dann aktuellen Katalog; angezeigt wird der heutige Katalogpreis.
	 */
	let {
		zeilen = $bindable(),
		nurLesen = false,
		katalogPreisFest = false,
		mitArbeitszeit = false
	}: { zeilen: EditorZeile[]; nurLesen?: boolean; katalogPreisFest?: boolean; mitArbeitszeit?: boolean } = $props();
	const preisFest = (z: EditorZeile) => katalogPreisFest && z.katalogPositionId !== null;

	const menge = (z: EditorZeile) => {
		try {
			return leseMenge(z.menge);
		} catch {
			return null;
		}
	};
	const preis = (z: EditorZeile) => {
		try {
			return z.einzelpreis.trim() === '' ? 0 : leseEuroInCent(z.einzelpreis);
		} catch {
			return null;
		}
	};
	const summe = (z: EditorZeile) => {
		const m = menge(z);
		const p = preis(z);
		return m === null || p === null ? null : positionsSumme(m, p);
	};

	function verschiebe(i: number, um: number) {
		const j = i + um;
		if (j < 0 || j >= zeilen.length) return;
		const neu = [...zeilen];
		[neu[i], neu[j]] = [neu[j], neu[i]];
		zeilen = neu;
	}
	function entferne(i: number) {
		zeilen = zeilen.filter((_, n) => n !== i);
	}
</script>

<div class="pe">
	<div class="pe-kopf" aria-hidden="true">
		<span>Pos.</span>
		<span>Bezeichnung</span>
		<span class="r">Menge</span>
		<span>Einheit</span>
		<span class="r">Einzelpreis</span>
		<span class="r">Gesamt</span>
		<span></span>
	</div>
	<ol class="pe-liste" aria-label="Positionen">
	{#each zeilen as z, i (z.schluessel)}
		{@const nr = i + 1}
		{@const s = summe(z)}
		<li class="pe-zeile" class:pe-pruefen={istKiPruefen(z.beschreibung)} data-testid="position">
			<span class="pe-pos">{nr}</span>
			<div class="pe-bez">
				<label>
					<span class="pe-label">Bezeichnung</span>
					<input type="text" bind:value={z.bezeichnung} maxlength="200" disabled={nurLesen} aria-label={`Bezeichnung Position ${nr}`} />
				</label>
				<label>
					<span class="pe-label">Beschreibung</span>
					<textarea bind:value={z.beschreibung} maxlength="2000" rows="2" disabled={nurLesen} aria-label={`Beschreibung Position ${nr}`} placeholder="Beschreibung (optional)"></textarea>
				</label>
				{#if z.katalogPositionId}
					<span class="pe-hinweis">{preisFest(z) ? 'aus dem Katalog – Preis wird beim Einfügen aktuell übernommen' : 'aus dem Katalog'}</span>
				{/if}
				{#if istKiPruefen(z.beschreibung)}<span class="pe-ki">bitte prüfen (KI-Vorschlag)</span>{/if}
				{#if mitArbeitszeit}
					<label class="pe-arbeit">
						<span>Arbeitszeit je {z.einheit}</span>
						<input
							type="text"
							inputmode="decimal"
							bind:value={z.arbeitMinuten}
							disabled={nurLesen}
							aria-label={`Arbeitszeit Position ${nr}`}
							placeholder={z.einheit === 'h' ? '60' : '–'}
						/>
						<span>Min.</span>
					</label>
				{/if}
			</div>
			<label class="pe-menge">
				<span class="pe-label">Menge</span>
				<input type="text" inputmode="decimal" bind:value={z.menge} disabled={nurLesen} aria-label={`Menge Position ${nr}`} aria-invalid={menge(z) === null} class="r" />
			</label>
			<label class="pe-einheit">
				<span class="pe-label">Einheit</span>
				<Auswahl bind:value={z.einheit} disabled={nurLesen} aria-label={`Einheit Position ${nr}`}>
					{#each EINHEITEN as e (e)}<option value={e}>{e}</option>{/each}
				</Auswahl>
			</label>
			<label class="pe-preis">
				<span class="pe-label">Einzelpreis (€)</span>
				<input type="text" inputmode="decimal" bind:value={z.einzelpreis} disabled={nurLesen || preisFest(z)} title={preisFest(z) ? 'Preis aus dem Katalog' : undefined} aria-label={`Einzelpreis Position ${nr}`} aria-invalid={preis(z) === null} class="r" placeholder="0,00" />
			</label>
			<span class="pe-summe r">
				<span class="pe-label">Gesamt</span>
				{#if s === null}<span class="pe-ungueltig">ungültig</span>{:else if preis(z) === 0}<span class="kt-preis-fehlt">Preis fehlt</span>{:else}{euro(s)}{/if}
			</span>
			{#if !nurLesen}
				<span class="pe-knoepfe">
					<button type="button" class="knopf-ghost klein" onclick={() => verschiebe(i, -1)} disabled={i === 0} aria-label={`Position ${nr} nach oben`}>↑</button>
					<button type="button" class="knopf-ghost klein" onclick={() => verschiebe(i, 1)} disabled={i === zeilen.length - 1} aria-label={`Position ${nr} nach unten`}>↓</button>
					<button type="button" class="weg" onclick={() => entferne(i)} aria-label={`Position ${nr} entfernen`}>✕</button>
				</span>
			{/if}
		</li>
	{:else}
		<li class="kd-leer">Noch keine Positionen.</li>
	{/each}
	</ol>
</div>

<style>
	/* KI-Vorschlag, bei dem die KI unsicher war: gelb, bis die Beschreibung angepasst ist */
	.pe-zeile.pe-pruefen {
		background: #fff6d6;
		box-shadow: inset 4px 0 0 #e0b100;
	}
	.pe-ki {
		display: inline-block;
		margin-top: 0.25rem;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		background: #ffe083;
		color: #4d3b00;
		font-size: 0.8rem;
		font-weight: 700;
	}
	.pe-zeile label.pe-arbeit {
		display: inline-flex;
		flex-direction: row;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.35rem;
		font-size: 0.8125rem;
		color: var(--m365-text-leise, #5b6168);
	}
	.pe-zeile .pe-arbeit input {
		width: 4.5rem !important;
		min-height: 2rem !important;
		padding: 0.15rem 0.4rem !important;
		text-align: right;
	}
	.pe {
		display: grid;
		gap: 0.6rem;
		margin: 0.5rem 0;
	}
	.pe-kopf {
		display: none;
	}
	.pe-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.pe-zeile {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
		grid-template-areas:
			'bez bez bez'
			'menge einheit preis'
			'summe knoepfe knoepfe';
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: #fff;
	}
	.pe-pos {
		grid-area: pos;
		font-weight: 700;
		align-self: start;
		padding-top: 0.6rem;
	}
	.pe-zeile .pe-pos {
		display: none;
	}
	.pe-bez {
		grid-area: bez;
		display: grid;
		gap: 0.4rem;
	}
	.pe-menge {
		grid-area: menge;
	}
	.pe-einheit {
		grid-area: einheit;
	}
	.pe-preis {
		grid-area: preis;
	}
	.pe-summe {
		grid-area: summe;
		align-self: center;
		font-weight: 700;
	}
	.pe-knoepfe {
		grid-area: knoepfe;
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
	}
	.pe label {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.pe-label {
		font-size: 0.8rem;
		color: var(--text-leise);
	}
	.pe-summe .pe-label {
		display: block;
		font-weight: 400;
	}
	.pe input,
	.pe select,
	.pe textarea {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0.45rem;
		border: 1px solid #8a8a8a;
		border-radius: 0.4rem;
		font: inherit;
		background: #fff;
	}
	.pe textarea {
		min-height: 2.75rem;
		font-size: 0.9rem;
		resize: vertical;
	}
	.pe input[aria-invalid='true'] {
		border-color: var(--fehler);
		background: #fff2f4;
	}
	.pe :disabled {
		background: #f4f5f7;
		color: var(--text);
	}
	.r {
		text-align: right;
	}
	.pe-hinweis {
		font-size: 0.75rem;
		color: var(--text-leise);
	}
	.pe-ungueltig {
		color: var(--fehler);
		font-weight: 600;
	}
	.pe-knoepfe button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		border: 1px solid var(--rand);
		border-radius: 0.4rem;
		background: #fff;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
	}
	.pe-knoepfe button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.pe-knoepfe .weg {
		color: var(--fehler);
	}

	@media (min-width: 700px) {
		.pe-liste {
			gap: 0;
		}
		.pe {
			gap: 0;
			border: 1px solid var(--rand);
			border-radius: 0.5rem;
			overflow: hidden;
			background: #fff;
		}
		.pe-kopf,
		.pe-zeile {
			display: grid;
			grid-template-columns: 2.25rem minmax(0, 1fr) 5.5rem 5.25rem 7rem 7.5rem 8.75rem;
			grid-template-areas: 'pos bez menge einheit preis summe knoepfe';
			gap: 0.5rem;
			align-items: start;
			padding: 0.5rem 0.6rem;
		}
		.pe-kopf {
			background: #eef1f5;
			font-weight: 600;
			font-size: 0.85rem;
		}
		.pe-zeile {
			border: 0;
			border-top: 1px solid var(--rand);
			border-radius: 0;
		}
		.pe-zeile .pe-pos {
			display: block;
		}
		.pe-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.pe-summe {
			align-self: start;
			padding-top: 0.65rem;
		}
		.pe-summe .pe-label {
			display: inline;
		}
		.pe .kd-leer {
			padding: 0.75rem;
			margin: 0;
		}
	}
</style>
