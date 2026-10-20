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
		/** Antwort auf eine Frage (nur lesend, z. B. Tagesplan) – ohne Speichern. */
		antwort?: {
			/** Seite, die sich direkt öffnet (z. B. gefilterter Kalender) */
			oeffnen?: string;
			abschnitte: { titel: string; eintraege: { zeit: string; titel: string; ort: string | null; link: string; ueberfaellig: boolean }[] }[];
			vorlesen: string;
			/** Text zum Kopieren (z. B. Buchungslink der Online-Buchung) */
			kopieren?: string;
		};
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

	// Antwort vorlesen (Browser-Sprachausgabe, Deutsch) – nur auf Knopfdruck
	const kannVorlesen = typeof window !== 'undefined' && 'speechSynthesis' in window;
	let liest = $state(false);
	function vorlesen(text: string) {
		if (!kannVorlesen) return;
		window.speechSynthesis.cancel();
		if (liest) {
			liest = false;
			return;
		}
		const u = new SpeechSynthesisUtterance(text);
		u.lang = 'de-DE';
		u.onend = () => (liest = false);
		liest = true;
		window.speechSynthesis.speak(u);
	}
	$effect(() => () => {
		if (kannVorlesen) window.speechSynthesis.cancel();
	});

	let kopiert = $state(false);
	async function kopiere(t: string) {
		try {
			await navigator.clipboard.writeText(t);
			kopiert = true;
			setTimeout(() => (kopiert = false), 2500);
		} catch {
			kopiert = false;
		}
	}
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

	{#if karte.antwort}
		<p class="bk-antwort-text">{karte.antwort.vorlesen}</p>
		{#if karte.antwort.kopieren}
			<div class="bk-kopieren">
				<input type="text" readonly value={karte.antwort.kopieren} aria-label="Zum Kopieren" onfocus={(e) => e.currentTarget.select()} />
				<button type="button" class="knopf bk-ja" onclick={() => kopiere(karte.antwort!.kopieren!)}>{kopiert ? 'Kopiert ✓' : 'Kopieren'}</button>
			</div>
		{/if}
		{#each karte.antwort.abschnitte as ab (ab.titel)}
			<section class="bk-abschnitt" aria-label={ab.titel}>
				<h3>{ab.titel} ({ab.eintraege.length})</h3>
				{#if ab.eintraege.length === 0}
					<p class="bk-leer">Keine.</p>
				{:else}
					<ul>
						{#each ab.eintraege as e, i (i)}
							<li class:ueberfaellig={e.ueberfaellig}>
								<span class="bk-zeit">{e.zeit}</span>
								{#if e.link.startsWith('http')}
									<a href={e.link} target="_blank" rel="noopener">{e.titel}</a>
								{:else}
									<a href={e.link} onclick={onabbrechen}>{e.titel}</a>
								{/if}
								{#if e.ort}<span class="bk-ort">{e.ort}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
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
		{#if karte.antwort && kannVorlesen}
			<button type="button" class="knopf bk-ja" onclick={() => vorlesen(karte.antwort!.vorlesen)}>{liest ? 'Stopp' : 'Vorlesen'}</button>
		{/if}
		<button type="button" class="bk-zweit" onclick={onabbrechen}>{karte.antwort ? 'Schließen' : 'Abbrechen'}</button>
	</div>
</section>

<style>
	.bk-kopieren {
		display: flex;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
	}
	.bk-kopieren input {
		flex: 1;
		min-width: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}
	.bk {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.bk-antwort-text {
		margin: 0;
		line-height: 1.6;
	}
	.bk-abschnitt h3 {
		margin: 0 0 0.35rem;
		font-size: 0.95rem;
	}
	.bk-abschnitt ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.bk-abschnitt li {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0 0.5rem;
	}
	.bk-abschnitt li .bk-ort {
		grid-column: 2;
		font-size: 0.85rem;
		color: var(--text-leise);
	}
	.bk-abschnitt li.ueberfaellig .bk-zeit {
		color: var(--m365-fehler, #b00020);
		font-weight: 600;
	}
	.bk-zeit {
		font-variant-numeric: tabular-nums;
		font-size: 0.875rem;
	}
	.bk-leer {
		margin: 0;
		color: var(--text-leise);
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
