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
	 */

	type Zustand = 'zu' | 'startet' | 'aufnahme' | 'versteht' | 'tippen' | 'karte' | 'fertig' | 'fehler';
	type Ergebnis = { text: string; vorschlag: string | null; karte: Karte };
	type Gespeichert = { meldung: string; link: string | null; warnungen: string[] };

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
		const beginn = Date.now();
		uhr = setInterval(() => {
			const vergangen = Date.now() - beginn;
			rest = Math.max(0, MAX_SEKUNDEN - Math.floor(vergangen / 1000));
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
			const schritt = () => {
				analyse.getByteTimeDomainData(daten);
				let summe = 0;
				for (const x of daten) summe += ((x - 128) / 128) ** 2;
				pegel = Math.min(1, Math.sqrt(summe / daten.length) * 4);
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

	// Fokus beim Öffnen in den Dialog setzen, beim Schließen zum Mikrofon zurück
	$effect(() => {
		if (offen && dialogEl) {
			const fokussierbar = dialogEl.querySelector<HTMLElement>(
				'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			queueMicrotask(() => (fokussierbar ?? dialogEl)?.focus());
		} else if (!offen && mikroEl) {
			const el = mikroEl;
			queueMicrotask(() => el.focus());
		}
	});

	onDestroy(() => {
		verwerfen = true;
		if (typeof window !== 'undefined') stoppe();
		stoppeStrom();
	});
</script>

<svelte:window onkeydown={taste} />

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

{#if offen}
	<button type="button" class="mk-schleier" tabindex="-1" aria-label="Dialog schließen" onclick={schliessen}></button>
	<div class="mk-dialog" role="dialog" aria-modal="true" aria-label="Sprachbefehl" bind:this={dialogEl} tabindex="-1">
		{#if zustand === 'startet'}
			<p class="mk-status" role="status">Mikrofon wird gestartet …</p>
		{:else if zustand === 'aufnahme'}
			<h2 class="mk-titel">Ich höre zu …</h2>
			<div class="mk-pegel" aria-hidden="true"><span style:width="{Math.round(pegel * 100)}%"></span></div>
			<p class="mk-rest" aria-live="off">Noch <strong>{restText}</strong> (höchstens 60 Sekunden)</p>
			<p class="mk-tipp">z. B. „Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Müller“</p>
			<div class="mk-knoepfe">
				<button type="button" class="knopf mk-gross" onclick={stoppe}>Fertig</button>
				<button type="button" class="mk-zweit" onclick={() => { verwerfen = true; stoppe(); zuTippen(null); }}>Befehl tippen</button>
				<button type="button" class="mk-zweit" onclick={schliessen}>Abbrechen</button>
			</div>
		{:else if zustand === 'versteht'}
			<p class="mk-status" role="status"><span class="mk-dreht" aria-hidden="true"></span> Wird verstanden …</p>
		{:else if zustand === 'tippen'}
			{#if meldung}<p class="mk-hinweis" class:mk-ohne={ohneMikro} role="alert">{meldung}</p>{/if}
			<form class="mk-form" onsubmit={verstehe}>
				<label for="mk-befehl">Befehl</label>
				<textarea
					id="mk-befehl"
					bind:this={eingabe}
					bind:value={befehl}
					maxlength="2000"
					rows="3"
					placeholder="z. B. Neues To-do für Murat: Silikonfuge erneuern, bis Freitag"
				></textarea>
				<div class="mk-knoepfe">
					<button type="submit" class="knopf mk-gross" disabled={befehl.trim() === ''}>Verstehen</button>
					<button type="button" class="mk-zweit" onclick={schliessen}>Abbrechen</button>
				</div>
			</form>
		{:else if zustand === 'fehler'}
			<p class="mk-hinweis" role="alert">{meldung}</p>
			<div class="mk-knoepfe">
				<button type="button" class="knopf mk-gross" onclick={() => void starte()}>Noch einmal sprechen</button>
				<button type="button" class="mk-zweit" onclick={() => zuTippen(null)}>Befehl tippen</button>
				<button type="button" class="mk-zweit" onclick={schliessen}>Abbrechen</button>
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
				<h2 class="mk-titel">Gespeichert</h2>
				<p>{gespeichert.meldung}</p>
				{#if gespeichert.warnungen.length > 0}
					<ul class="mk-warnungen">
						{#each gespeichert.warnungen as w, i (i)}<li>{w}</li>{/each}
					</ul>
				{/if}
				<div class="mk-knoepfe">
					{#if gespeichert.link}<a class="knopf mk-gross" href={gespeichert.link} onclick={schliessen}>Öffnen</a>{/if}
					<button type="button" class="mk-zweit" onclick={schliessen}>Schließen</button>
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
		border: 0;
		border-radius: 50%;
		background: var(--primaer);
		color: #fff;
		box-shadow: 0 4px 14px rgb(5 52 107 / 0.35);
		cursor: pointer;
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
	}
	.mikro:hover {
		background: var(--primaer-dunkel);
	}
	.mikro.aktiv {
		background: #c62828;
		box-shadow: 0 0 0 6px rgb(198 40 40 / 0.25);
	}
	.mk-schleier {
		position: fixed;
		inset: 0;
		z-index: 30;
		border: 0;
		padding: 0;
		background: rgb(0 0 0 / 0.35);
		cursor: default;
	}
	.mk-ohne {
		font-weight: 600;
	}
	.mk-dialog {
		position: fixed;
		z-index: 31;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 88vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem 1rem calc(1.25rem + env(safe-area-inset-bottom));
		border-radius: 1rem 1rem 0 0;
		background: var(--flaeche);
		box-shadow: 0 -6px 24px rgb(0 0 0 / 0.2);
	}
	.mk-titel {
		margin: 0;
		font-size: 1.25rem;
	}
	.mk-pegel {
		height: 0.9rem;
		border-radius: 0.45rem;
		background: var(--hintergrund);
		overflow: hidden;
	}
	.mk-pegel span {
		display: block;
		height: 100%;
		min-width: 4%;
		background: linear-gradient(90deg, #2e7d32, #f9a825);
		transition: width 80ms linear;
	}
	.mk-rest,
	.mk-tipp,
	.mk-status {
		margin: 0;
	}
	.mk-tipp {
		color: var(--text-leise);
		font-size: 0.9rem;
	}
	.mk-status {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 3rem;
		font-weight: 600;
	}
	.mk-dreht {
		width: 1.25rem;
		height: 1.25rem;
		border: 3px solid var(--primaer-hell);
		border-top-color: var(--primaer);
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
		padding: 0.6rem 0.75rem;
		border: 1px solid #e0b100;
		border-radius: 0.5rem;
		background: #fff6d6;
		color: #4d3b00;
	}
	.mk-form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.mk-form label {
		font-weight: 600;
	}
	.mk-form textarea {
		width: 100%;
		padding: 0.6rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		font-size: 1rem;
	}
	.mk-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.mk-gross {
		flex: 1 1 100%;
		min-height: 3.25rem;
		font-size: 1.1rem;
	}
	.mk-gross:disabled {
		opacity: 0.55;
	}
	.mk-zweit {
		flex: 1 1 0;
		min-height: var(--tippziel);
		padding: 0.5rem 1rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: var(--flaeche);
		color: var(--text);
		font-weight: 600;
		cursor: pointer;
	}
	.mk-fertig {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.mk-fertig p {
		margin: 0;
	}
	.mk-warnungen {
		margin: 0;
		padding: 0.6rem 0.75rem 0.6rem 1.75rem;
		border: 1px solid #e0b100;
		border-radius: 0.5rem;
		background: #fff6d6;
	}

	@media (min-width: 900px) {
		.mikro {
			right: 1.5rem;
			bottom: 1.5rem;
		}
		.mk-dialog {
			left: 50%;
			right: auto;
			bottom: auto;
			top: 12vh;
			width: min(34rem, calc(100vw - 2rem));
			transform: translateX(-50%);
			border-radius: 1rem;
			padding: 1.5rem;
		}
	}
</style>
