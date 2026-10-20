<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { STATUS, STATUS_NAMEN, type AuftragStatus } from '$lib/auftrag-status';
	import { terminKurz } from '$lib/einsatz-art';
	import { navigationsLink } from '$lib/kontakt-links';
	import { googleRouteLink, MAX_STOPPS, naechsterNachbar, STATUS_FARBEN } from '$lib/route';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	type A = PageData['auftraege'][number];
	type Stopp = { auftragId: string; nummer: string; titel: string; kundeName: string; adresse: string | null; zeit?: string; lat: number | null; lng: number | null };

	// ——— Route: aus „Termine heute“ oder per Auswahl ———
	const ausAuftrag = (a: A): Stopp => ({ auftragId: a.id, nummer: a.nummer, titel: a.titel, kundeName: a.kundeName, adresse: a.adresse, lat: a.lat, lng: a.lng });
	let stopps = $state<Stopp[]>(untrack(() => (data.route ? data.route.stopps : [])));
	$effect.pre(() => {
		// neue Daten (andere Route) übernehmen
		if (data.route) stopps = data.route.stopps;
	});
	const inRoute = (id: string) => stopps.some((s) => s.auftragId === id);
	function umschalten(a: A) {
		stopps = inRoute(a.id) ? stopps.filter((s) => s.auftragId !== a.id) : [...stopps, ausAuftrag(a)];
	}
	function verschiebe(i: number, um: number) {
		const j = i + um;
		if (j < 0 || j >= stopps.length) return;
		const neu = [...stopps];
		[neu[i], neu[j]] = [neu[j], neu[i]];
		stopps = neu;
	}
	const start = $derived(data.start && data.start.lat !== null && data.start.lng !== null ? { lat: data.start.lat, lng: data.start.lng } : null);
	const optimieren = () => (stopps = naechsterNachbar(start, stopps));
	const routeLink = $derived(googleRouteLink(data.start?.adresse ?? null, stopps.map((s) => s.adresse ?? '').filter(Boolean)));
	let gezogen = $state<number | null>(null);

	// ——— Karte (Leaflet nur im Browser) ———
	let kartenEl: HTMLDivElement | undefined = $state();
	let L: typeof import('leaflet') | null = null;
	let karte: import('leaflet').Map | null = null;
	let ebene: import('leaflet').LayerGroup | null = null;
	let linie: import('leaflet').Polyline | null = null;

	// Leaflet setzt Strings in Tooltips/Popups als innerHTML – Werte aus der Datenbank (Kundenname, Adresse …)
	// daher nur als DOM-Knoten mit textContent übergeben, nie als HTML-String (Sicherheitsprüfung Karte).
	function textKnoten(text: string): HTMLElement {
		const s = document.createElement('span');
		s.textContent = text;
		return s;
	}

	function popup(a: A): HTMLElement {
		const d = document.createElement('div');
		d.className = 'kt-popup';
		const zeile = (text: string, klasse = '') => {
			const p = document.createElement('p');
			p.textContent = text;
			if (klasse) p.className = klasse;
			d.append(p);
		};
		zeile(a.kundeName, 'kt-kunde');
		zeile(`${a.nummer} · ${a.titel}`);
		zeile(`Status: ${STATUS_NAMEN[a.status as AuftragStatus]}`);
		zeile(a.kommenderTermin ? `Nächster Termin: ${terminKurz(a.kommenderTermin)}` : 'Kein Termin geplant');
		if (a.adresse) zeile(a.adresse, 'kt-leise');
		if (a.ungefaehr) zeile('Lage ungefähr – Adresse nicht genau gefunden, Punkt zeigt PLZ/Ort.', 'kt-leise');
		const knoepfe = document.createElement('div');
		knoepfe.className = 'kt-popup-knoepfe';
		const link = (href: string, text: string, neu = false) => {
			const x = document.createElement('a');
			x.href = href;
			x.textContent = text;
			if (neu) {
				x.target = '_blank';
				x.rel = 'noopener';
			}
			knoepfe.append(x);
		};
		link(`/auftraege/${a.id}`, 'Öffnen');
		const nav = navigationsLink(a.adresse);
		if (nav) link(nav, 'Navigieren', true);
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = inRoute(a.id) ? 'Aus Route' : 'Zur Route';
		b.addEventListener('click', () => {
			umschalten(a);
			karte?.closePopup();
		});
		knoepfe.append(b);
		d.append(knoepfe);
		return d;
	}

	function zeichnen() {
		if (!L || !karte) return;
		ebene?.clearLayers();
		const punkte: [number, number][] = [];
		for (const a of data.auftraege) {
			if (a.lat === null || a.lng === null) continue;
			const m = L.circleMarker([a.lat, a.lng], {
				radius: 9,
				color: '#fff',
				weight: 2,
				fillColor: STATUS_FARBEN[a.status as AuftragStatus],
				fillOpacity: 0.95
			});
			m.bindPopup(() => popup(a));
			m.bindTooltip(textKnoten(`${a.nummer} · ${a.kundeName}`));
			ebene!.addLayer(m);
			punkte.push([a.lat, a.lng]);
		}
		if (start) {
			ebene!.addLayer(L.circleMarker([start.lat, start.lng], { radius: 7, color: '#1c1f23', weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(textKnoten('Betrieb (Start)')));
			punkte.push([start.lat, start.lng]);
		}
		if (punkte.length > 0) karte.fitBounds(L.latLngBounds(punkte), { padding: [30, 30], maxZoom: 14 });
	}

	function routeZeichnen() {
		if (!L || !karte) return;
		linie?.remove();
		const pfad = [...(start ? [start] : []), ...stopps.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ lat: s.lat!, lng: s.lng! }))];
		if (pfad.length >= 2) linie = L.polyline(pfad.map((p) => [p.lat, p.lng] as [number, number]), { color: '#0f6cbd', weight: 4, opacity: 0.7, dashArray: '6 6' }).addTo(karte);
	}

	onMount(() => {
		let aus = false;
		(async () => {
			const mod = await import('leaflet');
			await import('leaflet/dist/leaflet.css');
			if (aus || !kartenEl) return;
			L = mod.default ?? mod;
			karte = L.map(kartenEl, { zoomControl: true }).setView([51.1, 10.4], 6);
			// Kacheln über den eigenen Server (msg 2689): kein Aufruf an Dritte aus dem Browser, OSM-Regeln eingehalten
			L.tileLayer('/karte/kacheln/{z}/{x}/{y}.png', {
				maxZoom: 19,
				// Quellenangabe bleibt sichtbar; anderer Dienst: Text aus KARTE_ATTRIBUTION (maskiert)
				attribution: data.kachelHinweis
					? data.kachelHinweis.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
					: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
			}).addTo(karte);
			ebene = L.layerGroup().addTo(karte);
			zeichnen();
			routeZeichnen();
		})();
		return () => {
			aus = true;
			karte?.remove();
			karte = null;
		};
	});
	$effect(() => {
		void data.auftraege;
		zeichnen();
	});
	$effect(() => {
		void stopps;
		routeZeichnen();
	});

	const filterAnzahl = $derived(
		data.filter.status.length + (data.filter.benutzerId ? 1 : 0) + (data.filter.kolonneId ? 1 : 0) + (data.filter.von || data.filter.bis ? 1 : 0) + (data.filter.quelleId ? 1 : 0)
	);
	const ohneOrt = $derived(data.auftraege.filter((a) => a.lat === null));
</script>

<svelte:head>
	<title>Karte</title>
</svelte:head>

<main class="kd-seite breit kt-seite">
	<h1>Auftragskarte</h1>

	<details class="kt-filter">
		<summary class="kd-knopf hell">Filter{filterAnzahl > 0 ? ` (${filterAnzahl})` : ''}</summary>
		<form method="GET" class="kt-filter-form">
			<fieldset>
				<legend>Status</legend>
				{#each STATUS as s (s)}
					<label class="kd-haken">
						<input type="checkbox" name="status" value={s} checked={data.filter.status.includes(s)} />
						<span><span class="kt-punkt" style:background={STATUS_FARBEN[s]}></span>{STATUS_NAMEN[s]}</span>
					</label>
				{/each}
				<span class="kd-info">Ohne Auswahl: alle außer „Abgerechnet“</span>
			</fieldset>
			<div class="kt-raster">
				<label>
					Mitarbeiter
					<select name="ma">
						<option value="">alle</option>
						{#each data.mitarbeiter as m (m.id)}<option value={m.id} selected={data.filter.benutzerId === m.id}>{m.name}</option>{/each}
					</select>
				</label>
				{#if data.kolonnen.length > 0}
					<label>
						Kolonne
						<select name="ko">
							<option value="">alle</option>
							{#each data.kolonnen as ko (ko.id)}<option value={ko.id} selected={data.filter.kolonneId === ko.id}>{ko.name}</option>{/each}
						</select>
					</label>
				{/if}
				<label>Termine von <input type="date" name="von" value={data.filter.von ?? ''} /></label>
				<label>bis <input type="date" name="bis" value={data.filter.bis ?? ''} /></label>
				<label>
					Auftragsquelle
					<select name="quelle">
						<option value="">alle</option>
						{#each data.quellen as q (q.id)}<option value={q.id} selected={data.filter.quelleId === q.id}>{q.name}</option>{/each}
						<option value="ohne" selected={data.filter.quelleId === 'ohne'}>ohne Auftragsquelle</option>
					</select>
				</label>
			</div>
			<div class="kt-knoepfe">
				<button type="submit" class="kd-knopf">Anwenden</button>
				<a href="/karte" class="kd-knopf hell">Zurücksetzen</a>
			</div>
		</form>
	</details>

	<div class="kt-heute">
		<span class="kd-info">Route mit den Terminen von heute:</span>
		<a class="kd-knopf hell klein" href="/karte?route=heute">Meine</a>
		{#each data.mitarbeiter.filter((m) => m.id !== data.ich) as m (m.id)}<a class="kd-knopf hell klein" href={`/karte?route=heute&person=${m.id}`}>{m.name}</a>{/each}
		{#each data.kolonnen as ko (ko.id)}<a class="kd-knopf hell klein" href={`/karte?route=heute&kolonne=${ko.id}`}>{ko.name}</a>{/each}
	</div>
	{#if data.routeFehler}<p role="alert" class="kd-fehler">{data.routeFehler}</p>{/if}

	<div class="kt-haupt">
		<div class="kt-karte-huelle">
			<div bind:this={kartenEl} class="kt-karte" role="application" aria-label="Karte der Aufträge"></div>
			<ul class="kt-legende" aria-label="Legende">
				{#each STATUS as s (s)}<li><span class="kt-punkt" style:background={STATUS_FARBEN[s]}></span>{STATUS_NAMEN[s]}</li>{/each}
			</ul>
			{#if data.offen > 0}<p class="kd-info">{data.offen} Adressen werden noch gesucht – bitte später neu laden.</p>{/if}
			{#if !data.start}<p class="kd-info">Tipp: Mit der Betriebsadresse im <a href="/einstellungen/briefkopf">Briefkopf</a> beginnt die Route dort.</p>{/if}
		</div>

		<section class="kt-route" aria-labelledby="route-titel">
			<h2 id="route-titel">{data.route?.titel ?? 'Route'} ({stopps.length})</h2>
			{#if stopps.length === 0}
				<p class="kd-info">Aufträge auf der Karte oder in der Liste mit „Zur Route“ wählen – oder oben „Termine heute“.</p>
			{:else}
				{#if data.start}<p class="kd-info">Start: {data.start.adresse}</p>{/if}
				<ol class="kt-stopps">
					{#each stopps as s, i (s.auftragId)}
						<li
							draggable="true"
							class:gezogen={gezogen === i}
							ondragstart={() => (gezogen = i)}
							ondragover={(ev) => ev.preventDefault()}
							ondrop={() => {
								if (gezogen !== null && gezogen !== i) {
									const neu = [...stopps];
									const [x] = neu.splice(gezogen, 1);
									neu.splice(i, 0, x);
									stopps = neu;
								}
								gezogen = null;
							}}
						>
							<span class="kt-nr">{i + 1}</span>
							<span class="kt-was">
								<a href={`/auftraege/${s.auftragId}`}>{s.zeit ? `${s.zeit} · ` : ''}{s.kundeName}</a>
								<small>{s.adresse ?? 'keine Adresse'}{s.lat === null && s.adresse ? ' (Ort wird gesucht)' : ''}</small>
							</span>
							<span class="kt-pfeile">
								<button type="button" onclick={() => verschiebe(i, -1)} disabled={i === 0} aria-label={`Stopp ${i + 1} nach oben`}>↑</button>
								<button type="button" onclick={() => verschiebe(i, 1)} disabled={i === stopps.length - 1} aria-label={`Stopp ${i + 1} nach unten`}>↓</button>
								<button type="button" onclick={() => (stopps = stopps.filter((_, j) => j !== i))} aria-label={`Stopp ${i + 1} entfernen`}>✕</button>
							</span>
						</li>
					{/each}
				</ol>
				{#if stopps.length > MAX_STOPPS}<p class="kd-info">Google Maps nimmt höchstens {MAX_STOPPS} Stopps – die ersten {MAX_STOPPS} werden übernommen.</p>{/if}
				<div class="kt-knoepfe">
					<button type="button" class="kd-knopf hell" onclick={optimieren}>Kürzeste Reihenfolge</button>
					{#if routeLink}<a class="kd-knopf" href={routeLink} target="_blank" rel="noopener">Route in Google Maps öffnen</a>{/if}
				</div>
			{/if}
		</section>
	</div>

	<h2 class="kt-liste-titel">Aufträge ({data.auftraege.length})</h2>
	<ul class="kt-liste" aria-label="Aufträge auf der Karte">
		{#each data.auftraege as a (a.id)}
			<li>
				<span class="kt-punkt" style:background={STATUS_FARBEN[a.status as AuftragStatus]} title={STATUS_NAMEN[a.status as AuftragStatus]}></span>
				<span class="kt-was">
					<a href={`/auftraege/${a.id}`}>{a.nummer} · {a.kundeName}</a>
					<small>{a.titel}{a.adresse ? ` · ${a.adresse}` : ' · keine Adresse'}{a.lat === null && a.adresse ? (a.geoStatus === 'nicht_gefunden' ? ' (nicht gefunden)' : ' (wird gesucht)') : a.ungefaehr ? ' (Lage ungefähr)' : ''}</small>
				</span>
				<button type="button" class="kd-knopf hell klein" aria-pressed={inRoute(a.id)} onclick={() => umschalten(a)}>{inRoute(a.id) ? 'In Route ✓' : 'Zur Route'}</button>
			</li>
		{:else}
			<li class="kd-leer">Keine Aufträge für diese Auswahl.</li>
		{/each}
	</ul>
	{#if ohneOrt.length > 0}<p class="kd-info">{ohneOrt.length} Aufträge ohne Punkt auf der Karte (Adresse fehlt oder wurde nicht gefunden).</p>{/if}
</main>

<style>
	.kt-seite {
		max-width: 90rem;
	}
	.kt-filter > summary {
		display: inline-flex;
		list-style: none;
		cursor: pointer;
	}
	.kt-filter > summary::-webkit-details-marker {
		display: none;
	}
	.kt-filter-form {
		display: grid;
		gap: 0.75rem;
		margin: 0.5rem 0;
		padding: 0.75rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.kt-filter-form fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1rem;
		border: 0;
		margin: 0;
		padding: 0;
	}
	.kt-filter-form legend {
		font-weight: 600;
		font-size: 0.875rem;
	}
	.kt-raster {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
	}
	.kt-raster label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.kt-knoepfe,
	.kt-heute {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.kt-heute {
		margin: 0.75rem 0;
	}
	.kt-haupt {
		display: grid;
		gap: 1rem;
	}
	@media (min-width: 900px) {
		.kt-haupt {
			grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr);
			align-items: start;
		}
	}
	.kt-karte {
		height: min(65vh, 36rem);
		min-height: 18rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		z-index: 0;
	}
	.kt-legende {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.9rem;
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		font-size: 0.8125rem;
	}
	.kt-punkt {
		display: inline-block;
		width: 0.8rem;
		height: 0.8rem;
		margin-right: 0.35rem;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px var(--m365-rand-stark);
		vertical-align: -0.1rem;
		flex: none;
	}
	.kt-route {
		padding: 0.75rem 1rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.kt-route h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
	}
	.kt-stopps,
	.kt-liste {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.kt-stopps li,
	.kt-liste li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.kt-stopps li {
		cursor: grab;
	}
	.kt-stopps li.gezogen {
		opacity: 0.5;
	}
	.kt-nr {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.kt-was {
		flex: 1 1 auto;
		min-width: 0;
		display: grid;
		overflow-wrap: anywhere;
	}
	.kt-was small {
		color: var(--m365-text-leise);
	}
	.kt-pfeile {
		display: flex;
		gap: 0.2rem;
	}
	.kt-pfeile button {
		min-width: 2rem;
		min-height: 2rem;
		border: 1px solid var(--m365-rand);
		border-radius: 0.3rem;
		background: #fff;
		cursor: pointer;
	}
	.kt-liste-titel {
		font-size: 1.05rem;
		margin: 1.25rem 0 0.5rem;
	}
	:global(.kt-popup p) {
		margin: 0 0 0.2rem;
	}
	:global(.kt-popup .kt-kunde) {
		font-weight: 700;
	}
	:global(.kt-popup .kt-leise) {
		color: #5b6168;
	}
	:global(.kt-popup-knoepfe) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	:global(.kt-popup-knoepfe button) {
		border: 0;
		padding: 0;
		background: none;
		color: #0f6cbd;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
