<script lang="ts">
	import Avatar from './ui/Avatar.svelte';
	/**
	 * Bestätigungskarte der Sprachsteuerung: zeigt, was gespeichert würde („Auftrag Badsanierung, Kunde Müller,
	 * Montag 20.10., Ali + Mehmet“). Bei Mehrdeutigkeit eine Auswahl je Frage (große Knöpfe), Warnungen gelb, Hinweise
	 * (z. B. fehlende Berechtigung) rot. Gespeichert wird erst mit „Ja, speichern“ – und nur, wenn jede Frage
	 * beantwortet ist. „Ändern“ öffnet das normale Formular (vorausgefüllt).
	 */
	type Option = { id: string; label: string };
	type Auswahl = { feld: string; frage: string; optionen: Option[] };
	export type KartenSchritt = { nr: number; aktion: string; titel: string; zeilen: { label: string; wert: string }[]; warnungen: string[]; fehler: string | null };
	export type Karte = {
		aktion: string;
		/** Mehrere Schritte in einem Satz (Jamil msg 2983): nummerierte Vorschau, EIN „Ja, speichern“ für alle. */
		schritte?: KartenSchritt[];
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

	// Felder als ruhige Schlüssel/Wert-Liste mit Symbolen (Jamil msgs 2832/2833); „To-do“ heißt „Aufgabe“
	type Art = 'aufgabe' | 'person' | 'datum' | 'glocke' | 'kunde' | 'ort' | 'status' | 'text' | 'punkt';
	function artVon(label: string): Art {
		const l = label.toLowerCase();
		if (/erinner/.test(l)) return 'glocke';
		if (/zuständig|mitarbeiter|person|kolonne|monteur/.test(l)) return 'person';
		if (/fällig|datum|tag|wann|termin|zeit|beginn|ende|von|bis|woche|monat/.test(l)) return 'datum';
		if (/kunde/.test(l)) return 'kunde';
		if (/ort|adresse|objekt|anlage/.test(l)) return 'ort';
		if (/status|stufe/.test(l)) return 'status';
		if (/beschreibung|notiz|text|hinweis/.test(l)) return 'text';
		if (/titel|aufgabe|to-do|auftrag|angebot|leistung/.test(l)) return 'aufgabe';
		return 'punkt';
	}
	const SYMBOLE: Record<Exclude<Art, 'person'>, string> = {
		aufgabe: 'M5 3.5h6l1.5 1.5v8H3.5V3.5ZM6 8l1.5 1.5L10.5 6.5',
		datum: 'M3 4.5h10v8.5H3ZM3 7h10M5.5 3v2.5M10.5 3v2.5',
		glocke: 'M4.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3l1 1.5h-9ZM6.8 13.2a1.3 1.3 0 0 0 2.4 0',
		kunde: 'M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3.2 13.2c.9-2.2 2.7-3.3 4.8-3.3s3.9 1.1 4.8 3.3',
		ort: 'M8 14s4.5-4 4.5-7.3a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14ZM8 8.2a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
		status: 'M4 13.5V2.5M4 3h7.5l-1.5 2.5L11.5 8H4',
		text: 'M3 4.5h10M3 7.5h10M3 10.5h6',
		punkt: 'M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z'
	};
	const anzeigeLabel = (l: string) => l.replace(/To-dos?/g, (t) => (t.endsWith('s') ? 'Aufgaben' : 'Aufgabe'));
	const namen = (wert: string) =>
		wert
			.split(/,\s*|\s+und\s+|\s*\+\s*/)
			.map((n) => n.trim())
			.filter((n) => n && !/^(–|-|niemand|keine?r?)$/i.test(n));

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
	<header class="bk-kopf">
		<span class="ui-eyebrow">{karte.antwort ? 'Antwort' : 'Bitte bestätigen'}</span>
		<h2 class="ui-dialog-titel bk-titel">{karte.titel}</h2>
	</header>
	{#if text}
		<p class="bk-gehoert">
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9.5c0-2.5 1.2-4.2 3.3-5l.5.9C5.5 6 4.9 7 4.8 8.2H6.5V12H3Zm6 0c0-2.5 1.2-4.2 3.3-5l.5.9c-1.3.6-1.9 1.6-2 2.8h1.7V12H9Z" fill="currentColor" /></svg>
			<span><span class="unsichtbar">{'Verstanden: '}</span>„{text}“</span>
		</p>
	{/if}

	{#if karte.zeilen.length > 0}
		<dl class="bk-zeilen">
			{#each karte.zeilen as z, i (i)}
				{@const art = artVon(z.label)}
				<div class="bk-zeile">
					<dt>
						<span class="bk-symbol" aria-hidden="true">
							{#if art === 'person'}
								<svg viewBox="0 0 16 16"><path d={SYMBOLE.kunde} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
							{:else}
								<svg viewBox="0 0 16 16"><path d={SYMBOLE[art]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
							{/if}
						</span>
						{anzeigeLabel(z.label)}
					</dt>
					<dd>
						{#if art === 'person' && namen(z.wert).length > 0}
							<span class="bk-personen">
								{#each namen(z.wert) as n (n)}<span class="bk-person"><Avatar name={n} groesse={22} />{n}</span>{/each}
							</span>
						{:else}
							{z.wert}
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#if karte.schritte && karte.schritte.length > 0}
		<ol class="bk-schritte" aria-label="Schritte">
			{#each karte.schritte as st (st.nr)}
				<li class="bk-schritt" class:fehlt={!!st.fehler}>
					<span class="bk-nr" aria-hidden="true">{st.nr}</span>
					<div class="bk-schritt-inhalt">
						<p class="bk-schritt-titel"><span class="unsichtbar">Schritt {st.nr}: </span>{st.titel}</p>
						{#if st.zeilen.length > 0}
							<p class="bk-schritt-zeilen">{st.zeilen.map((z) => `${anzeigeLabel(z.label)}: ${z.wert}`).join(' · ')}</p>
						{/if}
						{#each st.warnungen as w, i (i)}<p class="bk-schritt-warnung">{w}</p>{/each}
						{#if st.fehler}<p class="bk-schritt-fehler">{st.fehler}</p>{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/if}

	{#if karte.antwort}
		<p class="bk-antwort-text">{karte.antwort.vorlesen}</p>
		{#if karte.antwort.kopieren}
			<div class="bk-kopieren">
				<input type="text" readonly value={karte.antwort.kopieren} aria-label="Zum Kopieren" onfocus={(e) => e.currentTarget.select()} />
				<button type="button" class="kd-knopf" onclick={() => kopiere(karte.antwort!.kopieren!)}>{kopiert ? 'Kopiert ✓' : 'Kopieren'}</button>
			</div>
		{/if}
		{#each karte.antwort.abschnitte as ab (ab.titel)}
			<section class="bk-abschnitt" aria-label={ab.titel}>
				<h3>{ab.titel} <span class="abschnitt-anzahl">{ab.eintraege.length}</span></h3>
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
		<div class="bk-auswahl" role="group" aria-label={a.frage}>
			<p class="bk-frage">{a.frage}</p>
			<div class="bk-optionen">
				{#each a.optionen as o (o.id)}
					<button
						type="button"
						class="bk-option"
						aria-pressed={gewaehlt[a.feld] === o.id}
						onclick={() => (gewaehlt = { ...gewaehlt, [a.feld]: o.id })}
					>
						<span class="bk-radio" aria-hidden="true"></span>{o.label}</button
					>
				{/each}
			</div>
			{#if label(a)}<p class="bk-gewaehlt">Gewählt: {label(a)}</p>{/if}
		</div>
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

	<div class="ui-dialog-fuss">
		{#if karte.aendern && karte.aktion !== 'unbekannt'}
			<a class="kd-knopf hell" href={karte.aendern} onclick={onabbrechen}>Ändern</a>
		{/if}
		{#if karte.antwort && kannVorlesen}
			<button type="button" class="kd-knopf hell" onclick={() => vorlesen(karte.antwort!.vorlesen)}>{liest ? 'Stopp' : 'Vorlesen'}</button>
		{/if}
		{#if vorschlag}
			<button type="button" class="kd-knopf hell" onclick={onabbrechen}>Abbrechen</button>
			<button type="button" class="kd-knopf primaer ui-gross" disabled={!vollstaendig || speichert} onclick={() => onspeichern(gewaehlt)}>
				<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
				{speichert ? 'Wird gespeichert …' : 'Ja, speichern'}
			</button>
		{:else}
			<button type="button" class="kd-knopf primaer ui-gross" onclick={onabbrechen}>{karte.antwort ? 'Schließen' : 'Abbrechen'}</button>
		{/if}
	</div>
</section>

<style>
	.bk-schritte {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.bk-schritt {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
	}
	.bk-schritt.fehlt {
		border-color: var(--ui-rot);
	}
	.bk-nr {
		flex: 0 0 auto;
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font-family: var(--ui-schrift-titel);
		font-weight: 700;
		font-size: 0.85rem;
	}
	.bk-schritt-inhalt {
		min-width: 0;
		display: grid;
		gap: 0.2rem;
	}
	.bk-schritt-inhalt p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.bk-schritt-titel {
		font-weight: 600;
	}
	.bk-schritt-zeilen {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.bk-schritt-warnung {
		color: var(--ui-orange);
		font-size: var(--ui-schrift-s);
	}
	.bk-schritt-fehler {
		color: var(--ui-rot);
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.bk {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.bk-kopf {
		display: grid;
		gap: 0.1rem;
	}
	.bk-gehoert {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 14px;
		background: var(--ui-akzent-zart);
		border: 1px solid var(--ui-akzent-hell);
		color: var(--ui-text);
		font-size: var(--ui-schrift-m);
		font-style: italic;
		line-height: 1.45;
	}
	.bk-gehoert svg {
		flex: none;
		width: 1rem;
		height: 1rem;
		margin-top: 0.15rem;
		color: var(--ui-akzent);
	}
	.bk-zeilen {
		margin: 0;
		display: grid;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		overflow: hidden;
	}
	.bk-zeile {
		display: grid;
		grid-template-columns: minmax(7rem, 38%) minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		min-height: 2.75rem;
		padding: 0.45rem 0.85rem;
	}
	.bk-zeile + .bk-zeile {
		border-top: 1px solid var(--ui-rand);
	}
	.bk-zeile dt {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.bk-symbol {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 8px;
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
	}
	.bk-symbol svg {
		width: 1rem;
		height: 1rem;
	}
	.bk-zeile dd {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.bk-personen {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.bk-person {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.6rem 0.15rem 0.15rem;
		border: 1px solid var(--ui-rand);
		border-radius: 999px;
		font-weight: 600;
	}
	.bk-antwort-text {
		margin: 0;
		line-height: 1.6;
	}
	.bk-kopieren {
		display: flex;
		gap: 0.5rem;
	}
	.bk-kopieren input {
		flex: 1;
		min-width: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}
	.bk-abschnitt h3 {
		margin: 0 0 0.35rem;
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
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
		color: var(--ui-text-leise);
	}
	.bk-abschnitt li.ueberfaellig .bk-zeit {
		color: var(--ui-gefahr);
		font-weight: 600;
	}
	.bk-zeit {
		font-variant-numeric: tabular-nums;
		font-size: 0.875rem;
	}
	.bk-leer {
		margin: 0;
		color: var(--ui-text-leise);
	}
	.bk-auswahl {
		display: grid;
		gap: 0.5rem;
		padding: 0.85rem;
		border-radius: var(--ui-radius-karte);
		background: var(--ui-akzent-zart);
		border: 1px solid var(--ui-akzent-rand);
	}
	.bk-frage {
		margin: 0;
		font-weight: 700;
	}
	.bk-optionen {
		display: grid;
		gap: 0.4rem;
	}
	.bk-option {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: var(--tippziel);
		padding: 0.5rem 0.85rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: 12px;
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.bk-radio {
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid var(--ui-rand-stark);
		border-radius: 50%;
	}
	.bk-option[aria-pressed='true'] {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent-hell);
		font-weight: 700;
	}
	.bk-option[aria-pressed='true'] .bk-radio {
		border: 5px solid var(--ui-akzent);
	}
	.bk-gewaehlt {
		margin: 0;
		font-size: 0.9rem;
	}
	.bk-warnungen {
		margin: 0;
		padding: 0.6rem 0.75rem 0.6rem 1.75rem;
		border-left: 4px solid var(--ui-orange);
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
		color: #5c3d0c;
	}
	.bk-fehler {
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-left: 4px solid var(--ui-gefahr);
		border-radius: var(--ui-radius);
		background: var(--ui-gefahr-hell);
		color: var(--ui-gefahr);
		font-weight: 600;
	}
</style>
