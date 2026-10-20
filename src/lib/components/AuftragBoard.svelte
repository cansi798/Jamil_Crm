<script lang="ts">
	import { STATUS_NAMEN, type AuftragStatus } from '$lib/auftrag-status';
	import {
		aktualisiereKarte,
		initialen,
		kurzAdresse,
		moeglicheZiele,
		verschiebeKarte,
		zielErlaubt,
		type BoardSpalte
	} from '$lib/auftrag-board';
	import { euro } from '$lib/geld';
	import AuftragHinweise from './AuftragHinweise.svelte';
	import type { AngebotInfo, NachfassenInfo } from '$lib/auftrag-hinweise';
	import { berlinTag, berlinUhrzeit, tagKurz } from '$lib/zeit';

	type Karte = {
		id: string;
		nummer: string;
		titel: string;
		status: AuftragStatus;
		kundeName: string;
		kundeArt: string;
		objektBezeichnung: string | null;
		adresse: string | null;
		zustaendige: { id: string; name: string }[];
		naechsterTermin: string | null;
		angebotNettoCent: number | null;
		angebotStatus: string | null;
			quelleName: string | null;
			quelleFarbe: string | null;
			angebotInfo: AngebotInfo | null;
			nachfassenInfo: NachfassenInfo | null;
		};

	/**
	 * Auftrags-Board (Kacheln je Status, Microsoft-Planner-Stil). Ab 700 px Breite: alle Spalten nebeneinander, Kacheln
	 * per Ziehen und Ablegen (Pointer Events: Maus, Stift, Finger) in die Nachbarspalte verschiebbar. Darunter: eine
	 * Spalte mit Status-Reitern. Immer möglich (auch per Tastatur): Menü „Status“ auf jeder Kachel.
	 * Verschieben ist sofort sichtbar (optimistisch) und wird bei einem Fehler des Servers zurückgenommen.
	 */
	let {
		spalten: start,
		darfBearbeiten,
		mitPreisen
	}: {
		spalten: BoardSpalte<Karte>[];
		darfBearbeiten: boolean;
		mitPreisen: boolean;
	} = $props();

	// Lokaler Zustand; neue Daten vom Server (z. B. nach einer Suche) ersetzen ihn
	let spalten = $derived(start);
	let meldung = $state('');
	let fehler = $state(false);
	let laeuft = $state<Set<string>>(new Set());

	// Handy: angezeigte Spalte (Reiter)
	let mobilStatus = $state<AuftragStatus | null>(null);
	const aktiveMobil = $derived(
		mobilStatus ?? spalten.find((s) => s.karten.length > 0)?.status ?? spalten[0]?.status ?? 'anfrage'
	);

	const termin = (iso: string) => {
		const d = new Date(iso);
		return `${tagKurz(berlinTag(d))} ${berlinUhrzeit(d)}`;
	};
	const ANGEBOT_NAMEN: Record<string, string> = { entwurf: 'Entwurf', versendet: 'versendet', angenommen: 'angenommen' };

	async function verschiebe(karte: Karte, nach: AuftragStatus) {
		if (!darfBearbeiten || laeuft.has(karte.id) || !zielErlaubt(karte.status, nach)) return;
		const von = karte.status;
		spalten = verschiebeKarte(spalten, karte.id, nach);
		laeuft = new Set([...laeuft, karte.id]);
		fehler = false;
		meldung = `„${karte.titel}“ wird nach „${STATUS_NAMEN[nach]}“ verschoben …`;
		try {
			const r = await fetch(`/api/auftraege/${karte.id}/status`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: nach })
			});
			const koerper = await r.json().catch(() => null);
			if (!r.ok) throw new Error(koerper?.fehler ?? `Fehler ${r.status}`);
			if (koerper?.id) spalten = aktualisiereKarte(spalten, { id: koerper.id, status: koerper.status, titel: koerper.titel });
			meldung = `„${karte.titel}“ ist jetzt „${STATUS_NAMEN[nach]}“.`;
		} catch (e) {
			// Zurücknehmen: Karte wieder in die alte Spalte
			spalten = verschiebeKarte(spalten, karte.id, von);
			fehler = true;
			meldung = `Status von „${karte.titel}“ konnte nicht geändert werden: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`;
		} finally {
			const neu = new Set(laeuft);
			neu.delete(karte.id);
			laeuft = neu;
		}
	}

	// ---- Ziehen und Ablegen ----
	type Zug = {
		karte: Karte;
		startX: number;
		startY: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		breite: number;
		aktiv: boolean;
		ziel: AuftragStatus | null;
	};
	let zug = $state<Zug | null>(null);
	let klickSperre = false;

	const breitGenug = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 700px)').matches;

	function spalteBei(x: number, y: number): AuftragStatus | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-spalte]');
		return (el?.dataset.spalte as AuftragStatus | undefined) ?? null;
	}

	function runter(ev: PointerEvent, karte: Karte) {
		if (!darfBearbeiten || !ev.isPrimary || ev.button !== 0 || !breitGenug()) return;
		if ((ev.target as Element).closest('button, summary, details[open], input, select, textarea')) return;
		const el = ev.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		zug = {
			karte,
			startX: ev.clientX,
			startY: ev.clientY,
			x: ev.clientX,
			y: ev.clientY,
			dx: ev.clientX - r.left,
			dy: ev.clientY - r.top,
			breite: r.width,
			aktiv: false,
			ziel: null
		};
	}

	function bewegen(ev: PointerEvent) {
		if (!zug) return;
		zug.x = ev.clientX;
		zug.y = ev.clientY;
		if (!zug.aktiv && Math.hypot(ev.clientX - zug.startX, ev.clientY - zug.startY) > 6) zug.aktiv = true;
		if (zug.aktiv) {
			ev.preventDefault();
			zug.ziel = spalteBei(ev.clientX, ev.clientY);
		}
	}

	function hoch(ev: PointerEvent) {
		const z = zug;
		zug = null;
		if (!z || !z.aktiv) return;
		klickSperre = true; // der folgende click gehört zum Ziehen, nicht zum Öffnen des Auftrags
		setTimeout(() => (klickSperre = false), 0);
		const ziel = spalteBei(ev.clientX, ev.clientY);
		if (!ziel || ziel === z.karte.status) return;
		if (!zielErlaubt(z.karte.status, ziel)) {
			fehler = true;
			meldung = `Nur ein Schritt in der Statuskette: „${STATUS_NAMEN[z.karte.status]}“ kann nicht direkt nach „${STATUS_NAMEN[ziel]}“.`;
			return;
		}
		void verschiebe(z.karte, ziel);
	}

	function abbrechen() {
		zug = null;
	}

	function klick(ev: MouseEvent) {
		if (klickSperre) {
			ev.preventDefault();
			ev.stopPropagation();
		}
	}

	function taste(ev: KeyboardEvent) {
		if (ev.key === 'Escape' && zug) zug = null;
	}

	const zielKlasse = (s: AuftragStatus) => {
		if (!zug?.aktiv) return '';
		if (s === zug.karte.status) return 'quelle';
		return zielErlaubt(zug.karte.status, s) ? (zug.ziel === s ? 'ziel erlaubt' : 'erlaubt') : 'gesperrt';
	};

	function waehle(ev: Event, karte: Karte, nach: AuftragStatus) {
		(ev.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
		void verschiebe(karte, nach);
	}
</script>

<svelte:window onkeydown={taste} onpointermove={bewegen} onpointerup={hoch} onpointercancel={abbrechen} />

<p class="ab-meldung" class:fehler role={fehler ? 'alert' : 'status'} aria-live="polite">{meldung}</p>

<nav class="ab-reiter" aria-label="Status wählen">
	{#each spalten as s (s.status)}
		<button
			type="button"
			class={`ab-reiter-knopf s-${s.status}`}
			aria-pressed={aktiveMobil === s.status}
			onclick={() => (mobilStatus = s.status)}
		>
			{STATUS_NAMEN[s.status]} <span class="ab-zahl">{s.anzahl}</span>
		</button>
	{/each}
</nav>

<div class="ab-board" class:zieht={zug?.aktiv}>
	{#each spalten as s (s.status)}
		<section
			class={`ab-spalte s-${s.status} ${zielKlasse(s.status)}`}
			class:mobil-aktiv={aktiveMobil === s.status}
			data-spalte={s.status}
			aria-labelledby={`ab-kopf-${s.status}`}
		>
			<header class="ab-kopf">
				<span class="ab-punkt" aria-hidden="true"></span>
				<h2 id={`ab-kopf-${s.status}`}>{STATUS_NAMEN[s.status]}</h2>
				<span class="ab-zahl" aria-label={`${s.anzahl} Aufträge`}>{s.anzahl}</span>
			</header>
			<ul class="ab-karten">
				{#each s.karten as k (k.id)}
					{@const adresse = kurzAdresse(k.adresse)}
					<li
						class="ab-karte"
						class:gezogen={zug?.aktiv && zug.karte.id === k.id}
						class:laeuft={laeuft.has(k.id)}
						class:ziehbar={darfBearbeiten}
						data-karte={k.id}
						onpointerdown={(ev) => runter(ev, k)}
					>
						<div class="ab-zeile">
							<span class="ab-nummer">{k.nummer}</span>
							{#if darfBearbeiten}
								<details class="ab-menue">
									<summary aria-label={`Status von „${k.titel}“ ändern`}>Status ▾</summary>
									<div class="ab-menue-liste">
										{#each moeglicheZiele(k.status) as z (z.status)}
											<button type="button" onclick={(ev) => waehle(ev, k, z.status)} disabled={laeuft.has(k.id)}>
												{z.richtung === 'zurueck' ? '← Zurück' : 'Weiter →'}: {STATUS_NAMEN[z.status]}
											</button>
										{/each}
									</div>
								</details>
							{/if}
						</div>
						<a href={`/auftraege/${k.id}`} class="ab-titel" draggable="false" onclick={klick}>{k.titel}</a>
						<p class="ab-kunde">{k.kundeName}{k.kundeArt === 'einmal' ? ' (Einmal-Kunde)' : ''}</p>
						<AuftragHinweise quelleName={k.quelleName} quelleFarbe={k.quelleFarbe} angebotInfo={k.angebotInfo} nachfassenInfo={k.nachfassenInfo} />
						{#if k.objektBezeichnung || adresse}
							<p class="ab-ort" title={k.adresse ?? undefined}>
								{k.objektBezeichnung ? `${k.objektBezeichnung}${adresse ? ' · ' : ''}` : ''}{adresse ?? ''}
							</p>
						{/if}
						{#if k.naechsterTermin || (mitPreisen && k.angebotNettoCent !== null)}
							<p class="ab-fakten">
								{#if k.naechsterTermin}<span class="ab-termin" title="Nächster Termin">📅 {termin(k.naechsterTermin)}</span>{/if}
								{#if mitPreisen && k.angebotNettoCent !== null}
									<span class="ab-wert" title="Angebot netto">{euro(k.angebotNettoCent)}{k.angebotStatus ? ` · ${ANGEBOT_NAMEN[k.angebotStatus] ?? k.angebotStatus}` : ''}</span>
								{/if}
							</p>
						{/if}
						{#if k.zustaendige.length > 0}
							<ul class="ab-chips" aria-label="Zuständig">
								{#each k.zustaendige as m (m.id)}
									<li title={m.name}><span class="ab-avatar" aria-hidden="true">{initialen(m.name)}</span>{m.name}</li>
								{/each}
							</ul>
						{/if}
					</li>
				{:else}
					<li class="ab-leer">Keine Aufträge</li>
				{/each}
			</ul>
			{#if s.anzahl > s.karten.length}
				<p class="ab-mehr">
					{s.karten.length} von {s.anzahl} angezeigt –
					<a href={`/auftraege?ansicht=liste&status=${s.status}`}>alle in der Liste</a>
				</p>
			{/if}
		</section>
	{/each}
</div>

{#if zug?.aktiv}
	<div
		class="ab-geist"
		style={`left:${zug.x - zug.dx}px; top:${zug.y - zug.dy}px; width:${zug.breite}px`}
		aria-hidden="true"
	>
		<span class="ab-nummer">{zug.karte.nummer}</span>
		<strong>{zug.karte.titel}</strong>
		<span class="ab-kunde">{zug.karte.kundeName}</span>
	</div>
{/if}

<style>
	.ab-meldung {
		min-height: 1.25rem;
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.ab-meldung.fehler {
		color: var(--m365-fehler);
		font-weight: 600;
	}

	/* Handy: Status-Reiter, eine Spalte */
	.ab-reiter {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		margin: 0 0 0.75rem;
		padding-bottom: 0.25rem;
		scrollbar-width: thin;
	}
	.ab-reiter-knopf {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: var(--tippziel, 44px);
		padding: 0 0.85rem;
		border: 1px solid var(--m365-rand-stark);
		border-radius: 999px;
		background: var(--m365-flaeche);
		color: var(--m365-text);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.ab-reiter-knopf[aria-pressed='true'] {
		border-color: var(--m365-primaer);
		background: var(--m365-primaer);
		color: #fff;
	}
	.ab-reiter-knopf[aria-pressed='true'] .ab-zahl {
		background: rgba(255, 255, 255, 0.25);
		color: #fff;
	}

	.ab-board {
		display: block;
	}
	.ab-spalte {
		display: none;
		--farbe: var(--m365-text-leicht);
	}
	.ab-spalte.mobil-aktiv {
		display: block;
	}
	.ab-spalte.s-angebot { --farbe: var(--m365-warnung); }
	.ab-spalte.s-beauftragt { --farbe: var(--m365-primaer); }
	.ab-spalte.s-in_arbeit { --farbe: var(--m365-erfolg); }
	.ab-spalte.s-abgenommen { --farbe: #8764b8; }
	.ab-spalte.s-abgerechnet { --farbe: var(--m365-text-leise); }

	@media (min-width: 700px) {
		.ab-reiter {
			display: none;
		}
		.ab-board {
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: minmax(12rem, 1fr);
			gap: 0.75rem;
			align-items: start;
			overflow-x: auto;
			padding-bottom: 0.5rem;
		}
		.ab-spalte {
			display: block;
		}
	}

	.ab-spalte {
		background: var(--m365-flaeche-hover);
		border-radius: var(--m365-radius-karte);
		padding: 0.5rem 0.5rem 0.75rem;
		border-top: 3px solid var(--farbe);
		outline: 2px solid transparent;
		outline-offset: -2px;
		transition: background 120ms, outline-color 120ms, opacity 120ms;
	}
	.ab-spalte.erlaubt {
		outline-color: var(--m365-rand-stark);
		outline-style: dashed;
	}
	.ab-spalte.ziel {
		outline-color: var(--m365-primaer);
		outline-style: solid;
		background: var(--m365-primaer-hell);
	}
	.ab-spalte.gesperrt {
		opacity: 0.45;
	}

	.ab-kopf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.25rem 0.5rem;
	}
	.ab-punkt {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--farbe);
	}
	.ab-kopf h2 {
		flex: 1;
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.ab-zahl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.375rem;
		border-radius: var(--m365-radius-gross);
		background: var(--m365-rand);
		color: var(--m365-text-leise);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.ab-karten {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		min-height: 4rem;
	}
	.ab-karte {
		position: relative;
		padding: 0.6rem 0.7rem 0.7rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
		transition: box-shadow 150ms, opacity 150ms;
	}
	.ab-karte:hover {
		box-shadow: var(--m365-schatten-hoch);
	}
	@media (min-width: 700px) {
		.ab-karte.ziehbar {
			cursor: grab;
			touch-action: none;
			user-select: none;
		}
	}
	.ab-karte.gezogen {
		opacity: 0.35;
	}
	.ab-karte.laeuft {
		opacity: 0.7;
	}
	.ab-zeile {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.ab-nummer {
		font-size: 0.6875rem;
		color: var(--m365-text-leise);
		font-variant-numeric: tabular-nums;
	}
	.ab-titel {
		display: block;
		margin: 0.15rem 0 0.2rem;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.35;
		color: var(--m365-text);
		text-decoration: none;
		-webkit-user-drag: none;
	}
	.ab-titel:hover,
	.ab-titel:focus-visible {
		color: var(--m365-primaer);
		text-decoration: underline;
	}
	.ab-kunde,
	.ab-ort,
	.ab-fakten {
		margin: 0 0 0.15rem;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--m365-text-leise);
	}
	.ab-kunde {
		color: var(--m365-text);
	}
	.ab-fakten {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
	}
	.ab-wert {
		font-weight: 600;
		color: var(--m365-text);
		font-variant-numeric: tabular-nums;
	}
	.ab-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0.35rem 0 0;
		padding: 0;
		list-style: none;
	}
	.ab-chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.45rem 0.1rem 0.1rem;
		border-radius: 999px;
		background: var(--m365-flaeche-hover);
		font-size: 0.6875rem;
		color: var(--m365-text);
	}
	.ab-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--m365-primaer);
		color: #fff;
		font-size: 0.5625rem;
		font-weight: 600;
	}

	.ab-menue {
		position: relative;
	}
	.ab-menue summary {
		display: inline-flex;
		align-items: center;
		min-height: 2rem;
		padding: 0 0.5rem;
		border-radius: var(--m365-radius);
		font-size: 0.75rem;
		color: var(--m365-primaer);
		cursor: pointer;
		list-style: none;
	}
	.ab-menue summary::-webkit-details-marker {
		display: none;
	}
	.ab-menue summary:hover {
		background: var(--m365-flaeche-hover);
	}
	.ab-menue-liste {
		position: absolute;
		right: 0;
		top: 100%;
		z-index: 5;
		display: grid;
		min-width: 13rem;
		padding: 0.25rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten-hoch);
	}
	.ab-menue-liste button {
		min-height: var(--tippziel, 44px);
		padding: 0 0.75rem;
		border: 0;
		border-radius: var(--m365-radius);
		background: transparent;
		color: var(--m365-text);
		font: inherit;
		font-size: 0.8125rem;
		text-align: left;
		cursor: pointer;
	}
	.ab-menue-liste button:hover,
	.ab-menue-liste button:focus-visible {
		background: var(--m365-primaer-hell);
	}

	.ab-leer {
		padding: 1.25rem 0.5rem;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--m365-text-leicht);
	}
	.ab-mehr {
		margin: 0.5rem 0.25rem 0;
		font-size: 0.75rem;
		color: var(--m365-text-leise);
	}
	.ab-mehr a {
		color: var(--m365-primaer);
	}

	.ab-geist {
		position: fixed;
		z-index: 50;
		display: grid;
		gap: 0.15rem;
		padding: 0.6rem 0.7rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten-hoch);
		pointer-events: none;
		transform: rotate(2deg);
		font-size: 0.875rem;
	}
	.ab-board.zieht {
		cursor: grabbing;
	}
</style>
