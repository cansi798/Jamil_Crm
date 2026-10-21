<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import Bestaetigungskarte, { type Karte } from './Bestaetigungskarte.svelte';

	/**
	 * Mikrofon-Knopf der Sprachsteuerung (rund, unten rechts). Antippen = Aufnahme starten, nochmal antippen bzw.
	 * „Fertig“ = stoppen; gedrückt halten = sprechen, loslassen = stoppen. Höchstens 60 Sekunden (Countdown), sichtbarer
	 * Pegel. Aufnahme mit dem besten Format des Browsers (webm/opus, ogg/opus, iOS Safari: mp4/aac) → `/api/sprache`;
	 * „Befehl tippen“ (oder ohne Mikrofon-Freigabe) → `/api/sprache/text`. Danach die Bestätigungskarte; gespeichert
	 * wird erst mit „Ja, speichern“ über `/api/sprache/ausfuehren`. Die Aufnahme bleibt nur im Speicher des Browsers,
	 * bis sie gesendet ist.
	 *
	 * Mit Schnellzugriff (msgs 3078/3079, `knopf={false}`): kein eigener Knopf – der Schnellzugriff ruft `oeffnen()`
	 * auf, und beim Schließen geht der Fokus an `zurueck()` (seinen Hauptknopf).
	 */
	let { knopf = true, zurueck }: { knopf?: boolean; zurueck?: () => HTMLElement | null } = $props();

	type Zustand = 'zu' | 'startet' | 'aufnahme' | 'versteht' | 'tippen' | 'karte' | 'fertig' | 'fehler';
	type Ergebnis = { text: string; vorschlag: string | null; karte: Karte };
	type SchrittStand = { nr: number; titel: string; status: 'erledigt' | 'fehler' | 'offen'; meldung: string | null; link: string | null };
	type Gespeichert = { meldung: string; link: string | null; warnungen: string[]; schritte?: SchrittStand[]; fehlgeschlagen?: boolean };

	const MAX_SEKUNDEN = 60;
	const HALTEN_MS = 600;

	let zustand = $state<Zustand>('zu');
	let meldung = $state<string | null>(null);
	let ohneMikro = $state(false);
	let befehl = $state('');
	let ergebnis = $state<Ergebnis | null>(null);
	let gespeichert = $state<Gespeichert | null>(null);
	let speichert = $state(false);
	let speicherFehler = $state<string | null>(null);
	let rest = $state(MAX_SEKUNDEN);
	let pegel = $state(0);
	// Ring-Countdown (Jamil msgs 2832/2833): Anteil der verstrichenen Zeit, flüssig je Bild; Pegel-Balken live
	let anteil = $state(0);
	let balken = $state<number[]>(Array(24).fill(0));
	let beginnMs = 0;
	const ruhig = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const RING_UMFANG = 2 * Math.PI * 52;

	let recorder: MediaRecorder | null = null;
	let strom: MediaStream | null = null;
	let teile: Blob[] = [];
	let uhr: ReturnType<typeof setInterval> | null = null;
	let bild = 0;
	let audio: AudioContext | null = null;
	let verwerfen = false;
	let druckBeginn = 0;
	let perDruck = false;
	let eingabe = $state<HTMLTextAreaElement | null>(null);
	let dialogEl = $state<HTMLDivElement | null>(null);
	let mikroEl = $state<HTMLButtonElement | null>(null);

	const offen = $derived(zustand !== 'zu');
	const restText = $derived(`${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`);

	function bestesFormat(): string {
		for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']) {
			if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)) return t;
		}
		return '';
	}

	/** Von außen (Schnellzugriff): Sprachsteuerung starten wie ein Tipp auf den Mikrofon-Knopf. */
	export function oeffnen() {
		if (zustand === 'zu') void starte();
	}

	function zuTippen(hinweis: string | null) {
		ohneMikro = hinweis !== null;
		meldung = hinweis;
		zustand = 'tippen';
		queueMicrotask(() => eingabe?.focus());
	}

	async function starte() {
		meldung = null;
		ohneMikro = false;
		ergebnis = null;
		gespeichert = null;
		speicherFehler = null;
		zustand = 'startet';
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
			zuTippen('Dieses Gerät kann hier nicht aufnehmen – bitte den Befehl tippen.');
			return;
		}
		try {
			strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
		} catch {
			zuTippen('Kein Zugriff aufs Mikrofon. Bitte im Browser erlauben – oder den Befehl tippen.');
			return;
		}
		if (zustand !== 'startet') {
			stoppeStrom();
			return;
		}
		const typ = bestesFormat();
		try {
			recorder = new MediaRecorder(strom, typ ? { mimeType: typ } : undefined);
		} catch {
			stoppeStrom();
			zuTippen('Dieses Gerät kann hier nicht aufnehmen – bitte den Befehl tippen.');
			return;
		}
		teile = [];
		verwerfen = false;
		const r = recorder;
		r.ondataavailable = (e) => {
			if (e.data.size > 0) teile.push(e.data);
		};
		r.onstop = () => void verarbeite(r.mimeType || typ || 'audio/webm');
		r.start(250);
		zustand = 'aufnahme';
		rest = MAX_SEKUNDEN;
		anteil = 0;
		const beginn = Date.now();
		beginnMs = beginn;
		uhr = setInterval(() => {
			const vergangen = Date.now() - beginn;
			rest = Math.max(0, MAX_SEKUNDEN - Math.floor(vergangen / 1000));
			if (ruhig) anteil = Math.min(1, (MAX_SEKUNDEN - rest) / MAX_SEKUNDEN);
			if (vergangen >= MAX_SEKUNDEN * 1000) stoppe();
		}, 200);
		startePegel(strom);
	}

	function startePegel(s: MediaStream) {
		try {
			audio = new AudioContext();
			const analyse = audio.createAnalyser();
			analyse.fftSize = 512;
			audio.createMediaStreamSource(s).connect(analyse);
			const daten = new Uint8Array(analyse.fftSize);
			const frequenzen = new Uint8Array(analyse.frequencyBinCount);
			const schritt = () => {
				analyse.getByteTimeDomainData(daten);
				let summe = 0;
				for (const x of daten) summe += ((x - 128) / 128) ** 2;
				pegel = Math.min(1, Math.sqrt(summe / daten.length) * 4);
				if (!ruhig) {
					anteil = Math.min(1, (Date.now() - beginnMs) / (MAX_SEKUNDEN * 1000));
					// Sprachbereich (ca. 100 Hz – 4 kHz) in 24 Balken
					analyse.getByteFrequencyData(frequenzen);
					const von = 2;
					const breite = Math.max(1, Math.floor(Math.min(frequenzen.length - von, 90) / 24));
					balken = balken.map((alt, i) => {
						let m = 0;
						for (let j = 0; j < breite; j++) m = Math.max(m, frequenzen[von + i * breite + j] ?? 0);
						return alt * 0.55 + (m / 255) * 0.45;
					});
				}
				bild = requestAnimationFrame(schritt);
			};
			schritt();
		} catch {
			pegel = 0;
		}
	}

	function aufraeumen() {
		if (uhr) clearInterval(uhr);
		uhr = null;
		cancelAnimationFrame(bild);
		void audio?.close().catch(() => {});
		audio = null;
		pegel = 0;
		balken = balken.map(() => 0);
	}

	function stoppeStrom() {
		for (const t of strom?.getTracks() ?? []) t.stop();
		strom = null;
	}

	function stoppe() {
		aufraeumen();
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		else stoppeStrom();
	}

	function schliessen() {
		verwerfen = true;
		stoppe();
		stoppeStrom();
		teile = [];
		zustand = 'zu';
		ergebnis = null;
		meldung = null;
		befehl = '';
	}

	async function verarbeite(typ: string) {
		stoppeStrom();
		recorder = null;
		if (verwerfen) {
			teile = [];
			return;
		}
		const aufnahme = new Blob(teile, { type: typ });
		teile = [];
		zustand = 'versteht';
		try {
			const antwort = await fetch('/api/sprache', { method: 'POST', headers: { 'content-type': typ }, body: aufnahme });
			await auswerten(antwort);
		} catch {
			fehler('Keine Verbindung – bitte noch einmal versuchen.');
		}
	}

	async function verstehe(e: SubmitEvent) {
		e.preventDefault();
		if (befehl.trim() === '') return;
		zustand = 'versteht';
		try {
			const antwort = await fetch('/api/sprache/text', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: befehl })
			});
			await auswerten(antwort);
		} catch {
			fehler('Keine Verbindung – bitte noch einmal versuchen.');
		}
	}

	function fehler(text: string) {
		meldung = text;
		zustand = 'fehler';
	}

	async function auswerten(antwort: Response) {
		if (verwerfen && zustand === 'zu') return;
		let koerper: any = null;
		try {
			koerper = await antwort.json();
		} catch {
			koerper = null;
		}
		if (!antwort.ok) {
			fehler(koerper?.fehler ?? 'Das hat nicht geklappt – bitte noch einmal.');
			return;
		}
		ergebnis = koerper as Ergebnis;
		zustand = 'karte';
		// „Zeig mir den Kalender …“: gleich dorthin (nur Seiten der App)
		const ziel = ergebnis.karte.antwort?.oeffnen;
		if (ziel && ziel.startsWith('/') && !ziel.startsWith('//')) {
			schliessen();
			await goto(ziel);
		}
	}

	async function speichern(auswahl: Record<string, string>) {
		if (!ergebnis?.vorschlag) return;
		speichert = true;
		speicherFehler = null;
		try {
			const antwort = await fetch('/api/sprache/ausfuehren', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ vorschlag: ergebnis.vorschlag, auswahl })
			});
			const koerper = await antwort.json().catch(() => null);
			if (!antwort.ok) {
				speicherFehler = koerper?.fehler ?? 'Speichern hat nicht geklappt.';
				return;
			}
			gespeichert = koerper as Gespeichert;
			zustand = 'fertig';
			await invalidateAll();
		} catch {
			speicherFehler = 'Keine Verbindung – bitte noch einmal versuchen.';
		} finally {
			speichert = false;
		}
	}

	// Knopf: kurz antippen = Start/Stopp; gedrückt halten (> 0,6 s) = beim Loslassen stoppen
	function druck(e: PointerEvent) {
		if (e.button !== 0 || zustand !== 'zu') return;
		druckBeginn = Date.now();
		perDruck = true;
		void starte();
	}
	function loslassen() {
		if (perDruck && Date.now() - druckBeginn > HALTEN_MS && (zustand === 'aufnahme' || zustand === 'startet')) {
			perDruck = false;
			stoppe();
		}
	}
	function klick() {
		if (perDruck) {
			perDruck = false;
			return;
		}
		if (zustand === 'zu') void starte();
		else if (zustand === 'aufnahme') stoppe();
	}

	function taste(e: KeyboardEvent) {
		if (e.key === 'Escape' && offen) {
			schliessen();
			return;
		}
		// Fokus-Trap: Tab/Shift+Tab nur innerhalb des Dialogs
		if (e.key === 'Tab' && offen && dialogEl) {
			const fokussierbar = dialogEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			if (fokussierbar.length === 0) return;
			const erster = fokussierbar[0];
			const letzter = fokussierbar[fokussierbar.length - 1];
			if (e.shiftKey) {
				if (document.activeElement === erster) {
					e.preventDefault();
					letzter.focus();
				}
			} else {
				if (document.activeElement === letzter) {
					e.preventDefault();
					erster.focus();
				}
			}
		}
	}

	// Fokus beim Öffnen in den Dialog setzen, beim Schließen zum Mikrofon (bzw. Schnellzugriff) zurück –
	// nur nach einem echten Schließen, nicht schon beim Laden der Seite
	let warOffen = false;
	$effect(() => {
		if (offen && dialogEl) {
			warOffen = true;
			const fokussierbar = dialogEl.querySelector<HTMLElement>(
				'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			queueMicrotask(() => (fokussierbar ?? dialogEl)?.focus());
		} else if (!offen && warOffen) {
			warOffen = false;
			const el = mikroEl ?? zurueck?.();
			if (el) queueMicrotask(() => el.focus());
		}
	});

	onDestroy(() => {
		verwerfen = true;
		if (typeof window !== 'undefined') stoppe();
		stoppeStrom();
	});
</script>

<svelte:window onkeydown={taste} />

{#if knopf}
	<button
		type="button"
		class="mikro"
		class:aktiv={zustand === 'aufnahme'}
		aria-label="Sprachbefehl"
		aria-pressed={zustand === 'aufnahme'}
		bind:this={mikroEl}
		onpointerdown={druck}
		onpointerup={loslassen}
		onpointerleave={loslassen}
		onclick={klick}
	>
		<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
			<path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Z" />
			<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
		</svg>
	</button>
{/if}

{#if offen}
	<button type="button" class="ui-schleier" tabindex="-1" aria-label="Dialog schließen" onclick={schliessen}></button>
	<div class="ui-dialog mk-dialog" role="dialog" aria-modal="true" aria-label="Sprachbefehl" bind:this={dialogEl} tabindex="-1">
		<span class="ui-dialog-griff" aria-hidden="true"></span>
		{#if zustand === 'startet'}
			<p class="mk-status" role="status"><span class="mk-dreht" aria-hidden="true"></span> Mikrofon wird gestartet …</p>
		{:else if zustand === 'aufnahme'}
			<h2 class="ui-dialog-titel mk-mitte-titel">Ich höre zu …</h2>
			<div class="mk-ring" class:ruhig role="timer" aria-label={`Noch ${rest} Sekunden`}>
				{#if !ruhig}<span class="mk-puls" aria-hidden="true" style:transform={`scale(${1 + pegel * 0.28})`} style:opacity={0.25 + pegel * 0.6}></span>{/if}
				<svg viewBox="0 0 120 120" aria-hidden="true">
					<circle class="mk-spur" cx="60" cy="60" r="52" />
					<circle
						class="mk-fortschritt"
						cx="60"
						cy="60"
						r="52"
						stroke-dasharray={RING_UMFANG}
						stroke-dashoffset={RING_UMFANG * anteil}
						class:knapp={rest <= 10}
					/>
				</svg>
				<span class="mk-mitte" aria-hidden="true">
					<span class="mk-zahl">{rest}</span>
					<span class="mk-einheit">Sekunden</span>
				</span>
			</div>
			{#if !ruhig}
				<div class="mk-welle" aria-hidden="true">
					{#each balken as h, i (i)}<span style:height={`${Math.max(8, Math.round(h * 100))}%`}></span>{/each}
				</div>
			{/if}
			<p class="mk-rest" aria-live="off">Noch {restText} · höchstens 60 Sekunden</p>
			<p class="mk-tipp">z. B. „Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Müller“</p>
			<div class="ui-dialog-fuss">
				<button type="button" class="kd-knopf hell" onclick={() => { verwerfen = true; stoppe(); zuTippen(null); }}>Befehl tippen</button>
				<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
				<button type="button" class="kd-knopf primaer ui-gross" onclick={stoppe}>
					<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
					Fertig
				</button>
			</div>
		{:else if zustand === 'versteht'}
			<p class="mk-status" role="status"><span class="mk-dreht" aria-hidden="true"></span> Wird verstanden …</p>
		{:else if zustand === 'tippen'}
			<h2 class="ui-dialog-titel">Befehl tippen</h2>
			{#if meldung}<p class="mk-hinweis" class:mk-ohne={ohneMikro} role="alert">{meldung}</p>{/if}
			<form class="mk-form" onsubmit={verstehe}>
				<label for="mk-befehl">Befehl</label>
				<textarea
					id="mk-befehl"
					bind:this={eingabe}
					bind:value={befehl}
					maxlength="2000"
					rows="3"
					placeholder="z. B. Neue Aufgabe für Murat: Silikonfuge erneuern, bis Freitag"
				></textarea>
				<div class="ui-dialog-fuss">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					<button type="submit" class="kd-knopf primaer ui-gross" disabled={befehl.trim() === ''}>Verstehen</button>
				</div>
			</form>
		{:else if zustand === 'fehler'}
			<h2 class="ui-dialog-titel">Das hat nicht geklappt</h2>
			<p class="mk-hinweis" role="alert">{meldung}</p>
			<div class="ui-dialog-fuss">
				<button type="button" class="kd-knopf hell" onclick={() => zuTippen(null)}>Befehl tippen</button>
				<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
				<button type="button" class="kd-knopf primaer ui-gross" onclick={() => void starte()}>Noch einmal sprechen</button>
			</div>
		{:else if zustand === 'karte' && ergebnis}
			<Bestaetigungskarte
				karte={ergebnis.karte}
				text={ergebnis.text}
				vorschlag={ergebnis.vorschlag}
				{speichert}
				fehler={speicherFehler}
				onspeichern={speichern}
				onabbrechen={schliessen}
			/>
		{:else if zustand === 'fertig' && gespeichert}
			<div class="mk-fertig" role="status">
{#if !gespeichert.fehlgeschlagen}
				<span class="mk-ok" aria-hidden="true"
					><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg></span
				>
				{/if}
				<h2 class="ui-dialog-titel">{gespeichert.fehlgeschlagen ? 'Nicht alles gespeichert' : 'Gespeichert'}</h2>
				<p>{gespeichert.meldung}</p>
				{#if gespeichert.schritte}
					<ol class="mk-schritte" aria-label="Ergebnis der Schritte">
						{#each gespeichert.schritte as st (st.nr)}
							<li class={`mk-schritt ${st.status}`}>
								<span class="mk-schritt-status">{st.status === 'erledigt' ? '✓ erledigt' : st.status === 'fehler' ? '✗ fehlgeschlagen' : '– nicht ausgeführt'}</span>
								<span><strong>{st.nr}. {st.titel}</strong>{#if st.meldung}: {st.meldung}{/if}</span>
							</li>
						{/each}
					</ol>
				{/if}
				{#if gespeichert.warnungen.length > 0}
					<ul class="mk-warnungen">
						{#each gespeichert.warnungen as w, i (i)}<li>{w}</li>{/each}
					</ul>
				{/if}
				<div class="ui-dialog-fuss">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Schließen</button>
					{#if gespeichert.link}<a class="kd-knopf primaer ui-gross" href={gespeichert.link} onclick={schliessen}>Öffnen</a>{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.mikro {
		position: fixed;
		z-index: 20;
		right: 1rem;
		bottom: calc(var(--nav-hoehe) + 0.75rem + env(safe-area-inset-bottom));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3.75rem;
		height: 3.75rem;
		border: 3px solid var(--ui-flaeche);
		border-radius: 50%;
		background: var(--ui-anthrazit-800);
		color: var(--ui-akzent); /* auf Anthrazit: helle Akzentfarbe */
		box-shadow: 0 6px 18px rgba(31, 30, 32, 0.35);
		cursor: pointer;
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
		transition: transform 150ms, background 150ms;
	}
	.mikro:hover {
		background: var(--ui-anthrazit-900);
		transform: translateY(-1px);
	}
	.mikro.aktiv {
		background: var(--ui-gefahr);
		color: #fff;
		box-shadow: 0 0 0 6px rgba(176, 58, 46, 0.25);
	}
	.mk-ohne {
		font-weight: 600;
	}
	.mk-mitte-titel {
		text-align: center;
	}
	/* Ring-Countdown mit Pegel-Puls */
	.mk-ring {
		position: relative;
		width: min(13rem, 62vw);
		aspect-ratio: 1;
		margin: 0.25rem auto 0;
	}
	.mk-ring svg {
		position: relative;
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}
	.mk-spur {
		fill: var(--ui-flaeche);
		stroke: var(--ui-akzent-hell);
		stroke-width: 8;
	}
	.mk-fortschritt {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 8;
		stroke-linecap: round;
		transition: stroke 300ms;
	}
	.mk-fortschritt.knapp {
		stroke: var(--ui-gefahr);
	}
	.mk-puls {
		position: absolute;
		inset: 6%;
		border-radius: 50%;
		background: radial-gradient(circle, var(--ui-akzent-rand) 0%, transparent 70%);
		transition: transform 90ms linear, opacity 90ms linear;
	}
	.mk-mitte {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		text-align: center;
		line-height: 1;
	}
	.mk-zahl {
		font-family: var(--ui-schrift-titel);
		font-size: clamp(2.75rem, 12vw, 3.5rem);
		font-weight: 800;
		color: var(--ui-text);
		font-variant-numeric: tabular-nums;
	}
	.mk-einheit {
		margin-top: 0.35rem;
		color: var(--ui-text-leise);
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.mk-welle {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		height: 2.25rem;
	}
	.mk-welle span {
		width: 4px;
		min-height: 3px;
		border-radius: 2px;
		background: var(--ui-akzent);
		transition: height 60ms linear;
	}
	.mk-rest,
	.mk-tipp {
		margin: 0;
		text-align: center;
	}
	.mk-rest {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-variant-numeric: tabular-nums;
	}
	.mk-tipp {
		align-self: center;
		max-width: 26rem;
		padding: 0.5rem 0.85rem;
		border-radius: 999px;
		background: var(--ui-band);
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-style: italic;
	}
	.mk-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		min-height: 6rem;
		margin: 0;
		font-weight: 600;
	}
	.mk-dreht {
		width: 1.4rem;
		height: 1.4rem;
		border: 3px solid var(--ui-akzent-hell);
		border-top-color: var(--ui-akzent);
		border-radius: 50%;
		animation: mk-drehen 0.9s linear infinite;
	}
	@keyframes mk-drehen {
		to {
			transform: rotate(360deg);
		}
	}
	.mk-hinweis {
		margin: 0;
		padding: 0.65rem 0.85rem;
		border-left: 4px solid var(--ui-orange);
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
		color: #5c3d0c;
	}
	.mk-form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.mk-form label {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.mk-form textarea {
		width: 100%;
		font-size: 1rem;
	}
	.mk-fertig {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}
	.mk-fertig p {
		margin: 0;
	}
	.mk-fertig .ui-dialog-fuss {
		align-self: stretch;
	}
	.mk-ok {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: var(--ui-gruen-hell);
		color: var(--ui-gruen);
	}
	.mk-ok svg {
		width: 1.75rem;
		height: 1.75rem;
	}
	.mk-schritte {
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.4rem;
		text-align: left;
	}
	.mk-schritt {
		display: grid;
		gap: 0.1rem;
		padding: 0.5rem 0.7rem;
		border-radius: var(--ui-radius);
		background: var(--ui-band);
		overflow-wrap: anywhere;
	}
	.mk-schritt-status {
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.mk-schritt.erledigt .mk-schritt-status {
		color: var(--ui-gruen);
	}
	.mk-schritt.fehler {
		background: var(--ui-rot-hell);
	}
	.mk-schritt.fehler .mk-schritt-status {
		color: var(--ui-rot);
	}
	.mk-schritt.offen .mk-schritt-status {
		color: var(--ui-text-leise);
	}
	.mk-warnungen {
		margin: 0;
		padding: 0.6rem 0.75rem 0.6rem 1.75rem;
		border-left: 4px solid var(--ui-orange);
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
		text-align: left;
	}
	@media (prefers-reduced-motion: reduce) {
		.mk-fortschritt {
			transition: none;
		}
	}
	@media (min-width: 900px) {
		.mikro {
			right: 1.5rem;
			bottom: 1.5rem;
		}
	}
</style>
