<script lang="ts">
	/**
	 * Bestätigungskarte der Sprachsteuerung: zeigt, was gespeichert würde („Auftrag Badsanierung, Kunde Müller,
	 * Montag 20.10., Ali + Mehmet“). Bei Mehrdeutigkeit eine Auswahl je Frage (große Knöpfe), Warnungen gelb, Hinweise
	 * (z. B. fehlende Berechtigung) rot. Gespeichert wird erst mit „Ja, speichern“ – und nur, wenn jede Frage
	 * beantwortet ist. „Ändern“ öffnet das normale Formular (vorausgefüllt).
	 */
	type Option = { id: string; label: string };
	type Auswahl = { feld: string; frage: string; optionen: Option[] };
	export type Karte = {
		aktion: string;
		titel: string;
		zeilen: { label: string; wert: string }[];
		auswahl: Auswahl[];
		warnungen: string[];
		fehler: string | null;
		aendern: string | null;
	};

	let {
		karte,
		text = null,
		vorschlag,
		speichert = false,
		fehler = null,
		onspeichern,
		onabbrechen
	}: {
		karte: Karte;
		text?: string | null;
		vorschlag: string | null;
		speichert?: boolean;
		/** Fehler beim Speichern (z. B. abgelaufen). */
		fehler?: string | null;
		onspeichern: (auswahl: Record<string, string>) => void;
		onabbrechen: () => void;
	} = $props();

	let gewaehlt = $state<Record<string, string>>({});
	const vollstaendig = $derived(karte.auswahl.every((a) => gewaehlt[a.feld]));
	const label = (a: Auswahl) => a.optionen.find((o) => o.id === gewaehlt[a.feld])?.label;
</script>

<section class="bk" aria-label="Bestätigung">
	<h2 class="bk-titel">{karte.titel}</h2>
	{#if text}
		<p class="bk-gehoert">Verstanden: „{text}“</p>
	{/if}

	{#if karte.zeilen.length > 0}
		<dl class="bk-zeilen">
			{#each karte.zeilen as z, i (i)}
				<div>
					<dt>{z.label}</dt>
					<dd>{z.wert}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#each karte.auswahl as a (a.feld)}
		<fieldset class="bk-auswahl">
			<legend>{a.frage}</legend>
			<div class="bk-optionen">
				{#each a.optionen as o (o.id)}
					<button
						type="button"
						class="bk-option"
						aria-pressed={gewaehlt[a.feld] === o.id}
						onclick={() => (gewaehlt = { ...gewaehlt, [a.feld]: o.id })}>{o.label}</button
					>
				{/each}
			</div>
			{#if label(a)}<p class="bk-gewaehlt">Gewählt: {label(a)}</p>{/if}
		</fieldset>
	{/each}

	{#if karte.warnungen.length > 0}
		<ul class="bk-warnungen">
			{#each karte.warnungen as w, i (i)}
				<li>{w}</li>
			{/each}
		</ul>
	{/if}

	{#if karte.fehler && karte.fehler !== karte.titel}
		<p class="bk-fehler" role="alert">{karte.fehler}</p>
	{/if}
	{#if fehler}
		<p class="bk-fehler" role="alert">{fehler}</p>
	{/if}

	<div class="bk-knoepfe">
		{#if vorschlag}
			<button type="button" class="knopf bk-ja" disabled={!vollstaendig || speichert} onclick={() => onspeichern(gewaehlt)}>
				{speichert ? 'Wird gespeichert …' : 'Ja, speichern'}
			</button>
		{/if}
		{#if karte.aendern && karte.aktion !== 'unbekannt'}
			<a class="bk-zweit" href={karte.aendern} onclick={onabbrechen}>Ändern</a>
		{/if}
		<button type="button" class="bk-zweit" onclick={onabbrechen}>Abbrechen</button>
	</div>
</section>

<style>
	.bk {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.bk-titel {
		margin: 0;
		font-size: 1.25rem;
	}
	.bk-gehoert {
		margin: 0;
		color: var(--text-leise);
		font-size: 0.9rem;
	}
	.bk-zeilen {
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.bk-zeilen div {
		display: grid;
		grid-template-columns: minmax(5.5rem, 30%) 1fr;
		gap: 0.5rem;
	}
	.bk-zeilen dt {
		color: var(--text-leise);
	}
	.bk-zeilen dd {
		margin: 0;
		font-weight: 600;
	}
	.bk-auswahl {
		margin: 0;
		padding: 0.75rem;
		border: 2px solid var(--primaer);
		border-radius: 0.5rem;
	}
	.bk-auswahl legend {
		padding: 0 0.25rem;
		font-weight: 700;
	}
	.bk-optionen {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.bk-option {
		min-height: var(--tippziel);
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: var(--flaeche);
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.bk-option[aria-pressed='true'] {
		border-color: var(--primaer);
		background: var(--primaer-hell);
		font-weight: 700;
		box-shadow: inset 4px 0 0 var(--primaer);
	}
	.bk-gewaehlt {
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
	}
	.bk-warnungen {
		margin: 0;
		padding: 0.6rem 0.75rem 0.6rem 1.75rem;
		border: 1px solid #e0b100;
		border-radius: 0.5rem;
		background: #fff6d6;
		color: #4d3b00;
	}
	.bk-fehler {
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 0.5rem;
		background: #fde8ec;
		color: var(--fehler);
		font-weight: 600;
	}
	.bk-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.bk-ja {
		flex: 1 1 100%;
		min-height: 3.25rem;
		font-size: 1.1rem;
	}
	.bk-ja:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.bk-zweit {
		flex: 1 1 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tippziel);
		padding: 0.5rem 1rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: var(--flaeche);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
</style>
