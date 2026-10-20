<script lang="ts" module>
	type Warnung = { art: 'doppelt'; einsatzId: string } | { art: 'urlaub' | 'krank' | 'sonstiges'; abwesenheitId: string };
	export type RasterEinsatz = {
		id: string;
		auftragId: string;
		auftragNummer: string;
		auftragTitel: string;
		kundeName: string;
		benutzerId: string;
		benutzerName: string;
		beginn: string;
		ende: string;
		notiz: string | null;
		warnungen: Warnung[];
		gruppe?: { id: string; vonTag: string; bisTag: string } | null;
		kolonne?: { id: string; name: string } | null;
	};
</script>

<script lang="ts" generics="Einsatz extends RasterEinsatz">
	import { berlinTag, berlinUhrzeit, tagKurz } from '$lib/zeit';

	type Abwesenheit = { id: string; benutzerId: string; art: 'urlaub' | 'krank' | 'sonstiges'; von: string; bis: string };
	type Mitarbeiter = { id: string; name: string; aktiv: boolean };

	/**
	 * Raster der Plantafel: Zeilen = Mitarbeiter, Spalten = 7 Tage. Ab 700 px Breite mit Ziehen und Ablegen (Pointer
	 * Events: Maus, Stift, Finger); darunter eine Tagesliste je Mitarbeiter mit Tag-Wischleiste, ohne Ziehen.
	 * Wer nicht planen darf, sieht nur (Kärtchen führen zum Auftrag). Gespeichert wird in der Seite (`onverschieben`).
	 */
	let {
		tage,
		heute,
		mitarbeiter,
		einsaetze,
		abwesenheiten,
		darfPlanen,
		kolonnen = [],
		onverschieben,
		onverlaengern = () => {},
		onzelle,
		onkolonne = () => {},
		oneinsatz
	}: {
		tage: string[];
		heute: string;
		mitarbeiter: Mitarbeiter[];
		einsaetze: Einsatz[];
		abwesenheiten: Abwesenheit[];
		darfPlanen: boolean;
		/** Kolonnen als eigene Zeilen oben (Wunsch Jamil msg 2510). */
		kolonnen?: { id: string; name: string; mitglieder: { id: string; name: string }[] }[];
		onverschieben: (e: Einsatz, tag: string, benutzerId: string) => void;
		/** Ende eines mehrtägigen Termins auf einen anderen Tag ziehen. */
		onverlaengern?: (e: Einsatz, bisTag: string) => void;
		onzelle: (tag: string, benutzerId: string) => void;
		/** „+“ in einer Kolonnen-Zeile. */
		onkolonne?: (tag: string, kolonneId: string) => void;
		oneinsatz: (e: Einsatz) => void;
	} = $props();

	const ABW_NAMEN = { urlaub: 'Urlaub', krank: 'Krank', sonstiges: 'Abwesend' } as const;
	const WARN_NAMEN = { doppelt: 'Doppelbelegung', urlaub: 'Urlaub', krank: 'Krankheit', sonstiges: 'Abwesenheit' } as const;

	const tagVon = (e: Einsatz) => berlinTag(new Date(e.beginn));
	const zeit = (e: Einsatz) => `${berlinUhrzeit(new Date(e.beginn))}–${berlinUhrzeit(new Date(e.ende))}`;
	const warnText = (e: Einsatz) =>
		[...new Set(e.warnungen.map((w) => WARN_NAMEN[w.art]))].map((t) => `Achtung: ${t}`).join(', ');
	const kartenLabel = (e: Einsatz) =>
		[`${zeit(e)}, ${e.auftragNummer}, ${e.kundeName}, ${e.benutzerName}`, warnText(e)].filter(Boolean).join(' – ');

	/** Einsätze je „Mitarbeiter|Tag“; Kolonnen-Einsätze zusätzlich je „ko:Kolonne|Tag“ (einer je Gruppe). */
	const zellen = $derived.by(() => {
		const m = new Map<string, Einsatz[]>();
		const fuege = (schluessel: string, e: Einsatz) => m.set(schluessel, [...(m.get(schluessel) ?? []), e]);
		for (const e of einsaetze) {
			fuege(`${e.benutzerId}|${tagVon(e)}`, e);
			if (e.kolonne) {
				const s = `ko:${e.kolonne.id}|${tagVon(e)}`;
				if (!(m.get(s) ?? []).some((x) => x.gruppe?.id === e.gruppe?.id)) fuege(s, e);
			}
		}
		return m;
	});
	const inZelle = (benutzerId: string, tag: string) => zellen.get(`${benutzerId}|${tag}`) ?? [];
	/** Teil eines mehrtägigen Balkens: Anfang, Mitte oder Ende (null = eintägig). */
	const segment = (e: Einsatz, tag: string) =>
		!e.gruppe || e.gruppe.vonTag === e.gruppe.bisTag ? null : tag === e.gruppe.vonTag ? 'anfang' : tag === e.gruppe.bisTag ? 'ende' : 'mitte';
	const personenImTermin = (e: Einsatz, tag: string) =>
		einsaetze.filter((x) => x.gruppe?.id === e.gruppe?.id && tagVon(x) === tag).length;
	const abwesenheitAm = (benutzerId: string, tag: string) =>
		abwesenheiten.find((a) => a.benutzerId === benutzerId && a.von <= tag && a.bis >= tag) ?? null;

	// ---- Ziehen und Ablegen (nur Raster, nur mit Planungsrecht) ----
	type Zug = {
		einsatz: Einsatz;
		startX: number;
		startY: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		breite: number;
		aktiv: boolean;
		ziel: { tag: string; benutzerId: string } | null;
		/** ziehen = verschieben, ende = mehrtägigen Termin verlängern/kürzen */
		modus: 'ziehen' | 'ende';
	};
	let zug = $state<Zug | null>(null);
	let klickSperre = false;

	function zelleBei(x: number, y: number): { tag: string; benutzerId: string } | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-zelle]');
		return el?.dataset.tag && el.dataset.benutzer ? { tag: el.dataset.tag, benutzerId: el.dataset.benutzer } : null;
	}

	function runter(ev: PointerEvent, e: Einsatz, modus: 'ziehen' | 'ende' = 'ziehen') {
		if (!darfPlanen || !ev.isPrimary || ev.button !== 0) return;
		ev.stopPropagation();
		const el = ev.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		zug = {
			einsatz: e,
			startX: ev.clientX,
			startY: ev.clientY,
			x: ev.clientX,
			y: ev.clientY,
			dx: ev.clientX - r.left,
			dy: ev.clientY - r.top,
			breite: r.width,
			aktiv: false,
			ziel: null,
			modus
		};
		el.setPointerCapture(ev.pointerId);
	}

	function bewegen(ev: PointerEvent) {
		if (!zug) return;
		zug.x = ev.clientX;
		zug.y = ev.clientY;
		if (!zug.aktiv && Math.hypot(ev.clientX - zug.startX, ev.clientY - zug.startY) > 6) zug.aktiv = true;
		if (zug.aktiv) {
			ev.preventDefault();
			zug.ziel = zelleBei(ev.clientX, ev.clientY);
		}
	}

	function hoch(ev: PointerEvent) {
		const z = zug;
		zug = null;
		if (!z || !z.aktiv) return;
		klickSperre = true; // der folgende click gehört zum Ziehen, nicht zum Öffnen
		setTimeout(() => (klickSperre = false), 0);
		const ziel = zelleBei(ev.clientX, ev.clientY);
		if (z.modus === 'ende') {
			if (ziel && z.einsatz.gruppe && ziel.tag !== z.einsatz.gruppe.bisTag) onverlaengern(z.einsatz, ziel.tag);
			return;
		}
		if (ziel && (ziel.tag !== tagVon(z.einsatz) || ziel.benutzerId !== z.einsatz.benutzerId)) {
			onverschieben(z.einsatz, ziel.tag, ziel.benutzerId);
		}
	}

	function abbrechen() {
		zug = null;
	}

	function klick(e: Einsatz) {
		if (klickSperre) return;
		oneinsatz(e);
	}

	const istZiel = (benutzerId: string, tag: string) =>
		zug?.aktiv === true && zug.ziel?.tag === tag && zug.ziel?.benutzerId === benutzerId;

	// ---- Handy: Tag-Wischleiste ----
	let gewaehlt = $state<string | null>(null);
	const tagMobil = $derived(gewaehlt && tage.includes(gewaehlt) ? gewaehlt : tage.includes(heute) ? heute : tage[0]);
	let leiste: HTMLUListElement | undefined = $state();

	// Gewählten Tag in der Wischleiste sichtbar halten (z. B. „heute“ am Wochenende)
	$effect(() => {
		const knopf = leiste?.querySelector<HTMLElement>(`[data-tagknopf="${tagMobil}"]`);
		if (knopf && leiste && leiste.offsetParent !== null) {
			leiste.scrollLeft = knopf.offsetLeft - leiste.offsetLeft - 16;
		}
	});
</script>

{#snippet karte(e: Einsatz, ziehbar: boolean, tag: string = tagVon(e), lane = false)}
	{@const seg = segment(e, tag)}
	{#if e.kolonne && !lane}
		<!-- Kolonnen-Einsatz in der Zeile des Mitglieds: kleiner Hinweis, gezogen wird in der Kolonnen-Zeile -->
		<button type="button" class="pt-ko-chip" class:warn={e.warnungen.length > 0} aria-label={`${e.kolonne.name}: ${kartenLabel(e)}`} onclick={() => klick(e)}>
			{e.kolonne.name} · {zeit(e)}
		</button>
	{:else if darfPlanen}
		<div class="pt-karte-huelle" class:seg-anfang={seg === 'anfang'} class:seg-mitte={seg === 'mitte'} class:seg-ende={seg === 'ende'}>
		<button
			type="button"
			class="pt-karte"
			class:gruppe={!!seg}
			class:ko={lane}
			class:warn={e.warnungen.length > 0}
			class:gezogen={zug?.aktiv && zug.einsatz.id === e.id}
			class:ziehbar
			data-einsatz={e.id}
			aria-label={kartenLabel(e)}
			title={warnText(e) || undefined}
			onpointerdown={ziehbar ? (ev) => runter(ev, e) : undefined}
			onpointermove={ziehbar ? bewegen : undefined}
			onpointerup={ziehbar ? hoch : undefined}
			onpointercancel={ziehbar ? abbrechen : undefined}
			onclick={() => klick(e)}
		>
			<span class="pt-zeit">{seg && seg !== 'anfang' ? '↳ ' : ''}{zeit(e)}{#if e.warnungen.length > 0}<span class="pt-warnzeichen" aria-hidden="true"> ⚠</span>{/if}</span>
			<span class="pt-nr">{e.auftragNummer}{lane ? ` · ${personenImTermin(e, tag)} Pers.` : ''}</span>
			<span class="pt-kunde">{e.kundeName}</span>
		</button>
		{#if ziehbar && seg === 'ende'}
			<button
				type="button"
				class="pt-griff"
				aria-label={`Termin ${e.auftragNummer} verlängern oder kürzen (Ende ziehen)`}
				title="Ende ziehen: verlängern oder kürzen"
				onpointerdown={(ev) => runter(ev, e, 'ende')}
				onpointermove={bewegen}
				onpointerup={hoch}
				onpointercancel={abbrechen}>⇥</button
			>
		{/if}
		</div>
	{:else}
		<a
			href={`/auftraege/${e.auftragId}`}
			class="pt-karte"
			class:warn={e.warnungen.length > 0}
			data-einsatz={e.id}
			aria-label={kartenLabel(e)}
			title={warnText(e) || undefined}
		>
			<span class="pt-zeit">{zeit(e)}{#if e.warnungen.length > 0}<span class="pt-warnzeichen" aria-hidden="true"> ⚠</span>{/if}</span>
			<span class="pt-nr">{e.auftragNummer}</span>
			<span class="pt-kunde">{e.kundeName}</span>
		</a>
	{/if}
{/snippet}

<!-- Tablet und PC: Raster mit Ziehen und Ablegen -->
<div class="pt-huelle">
	<table class="pt-raster">
		<caption class="unsichtbar">Plantafel: Mitarbeiter und Tage</caption>
		<thead>
			<tr>
				<th scope="col" class="pt-ecke">Mitarbeiter</th>
				{#each tage as t (t)}
					<th scope="col" class:heute={t === heute} aria-current={t === heute ? 'date' : undefined}>{tagKurz(t)}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each kolonnen as ko (ko.id)}
				<tr class="pt-ko-zeile">
					<th scope="row" class="pt-name">
						{ko.name}<small>{ko.mitglieder.map((m) => m.name.split(' ')[0]).join(', ')}</small>
					</th>
					{#each tage as t (t)}
						<td class="pt-zelle" class:heute={t === heute} data-zelle data-tag={t} data-benutzer={`ko:${ko.id}`}>
							{#each inZelle(`ko:${ko.id}`, t) as e (e.id)}
								{@render karte(e, true, t, true)}
							{/each}
							{#if darfPlanen}
								<button type="button" class="pt-plus" aria-label={`${ko.name} am ${tagKurz(t)} einplanen`} onclick={() => onkolonne(t, ko.id)}>+</button>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
			{#each mitarbeiter as m (m.id)}
				<tr>
					<th scope="row" class="pt-name" class:inaktiv={!m.aktiv}>
						{m.name}{#if !m.aktiv}<small> (deaktiviert)</small>{/if}
					</th>
					{#each tage as t (t)}
						{@const abw = abwesenheitAm(m.id, t)}
						<td
							class="pt-zelle"
							class:heute={t === heute}
							class:abwesend={abw !== null}
							class:ziel={istZiel(m.id, t)}
							data-zelle
							data-tag={t}
							data-benutzer={m.id}
						>
							{#if abw}<span class="pt-abw">{ABW_NAMEN[abw.art]}</span>{/if}
							{#each inZelle(m.id, t) as e (e.id)}
								{@render karte(e, true, t)}
							{/each}
							{#if darfPlanen && m.aktiv}
								<button
									type="button"
									class="pt-plus"
									aria-label={`Einsatz für ${m.name} am ${tagKurz(t)} anlegen`}
									onclick={() => onzelle(t, m.id)}>+</button
								>
							{/if}
						</td>
					{/each}
				</tr>
			{:else}
				<tr><td colspan="8" class="pt-leer">Keine Mitarbeiter.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

{#if zug?.aktiv}
	<div
		class="pt-geist"
		aria-hidden="true"
		style:left={`${zug.x - zug.dx}px`}
		style:top={`${zug.y - zug.dy}px`}
		style:width={`${zug.breite}px`}
	>
		<span class="pt-zeit">{zeit(zug.einsatz)}</span>
		<span class="pt-nr">{zug.einsatz.auftragNummer}</span>
		<span class="pt-kunde">{zug.einsatz.kundeName}</span>
	</div>
{/if}

<!-- Handy: Tagesliste je Mitarbeiter -->
<div class="pt-mobil">
	<ul class="pt-tage" aria-label="Tag wählen" bind:this={leiste}>
		{#each tage as t (t)}
			<li>
				<button
					type="button"
					data-tagknopf={t}
					aria-pressed={t === tagMobil}
					class:heute={t === heute}
					onclick={() => (gewaehlt = t)}
				>
					{tagKurz(t)}
				</button>
			</li>
		{/each}
	</ul>
	<h2 class="pt-tagtitel">{tagKurz(tagMobil)}{tagMobil === heute ? ' – heute' : ''}</h2>
	<ul class="pt-personen">
		{#each kolonnen as ko (ko.id)}
			{@const liste = inZelle(`ko:${ko.id}`, tagMobil)}
			<li class="pt-person pt-ko-zeile">
				<div class="pt-person-kopf"><strong>{ko.name}</strong><small>{ko.mitglieder.map((m) => m.name.split(' ')[0]).join(', ')}</small></div>
				{#each liste as e (e.id)}
					{@render karte(e, false, tagMobil, true)}
				{:else}
					<span class="pt-frei">frei</span>
				{/each}
				{#if darfPlanen}
					<button type="button" class="pt-plus-mobil" onclick={() => onkolonne(tagMobil, ko.id)}>+ {ko.name} einplanen</button>
				{/if}
			</li>
		{/each}
		{#each mitarbeiter as m (m.id)}
			{@const abw = abwesenheitAm(m.id, tagMobil)}
			{@const liste = inZelle(m.id, tagMobil)}
			<li class="pt-person" class:abwesend={abw !== null}>
				<div class="pt-person-kopf">
					<strong class:inaktiv={!m.aktiv}>{m.name}</strong>
					{#if abw}<span class="pt-abw">{ABW_NAMEN[abw.art]}</span>{/if}
				</div>
				{#each liste as e (e.id)}
					{@render karte(e, false, tagMobil)}
				{:else}
					<span class="pt-frei">frei</span>
				{/each}
				{#if darfPlanen && m.aktiv}
					<button type="button" class="pt-plus-mobil" onclick={() => onzelle(tagMobil, m.id)}>+ Einsatz für {m.name}</button>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.unsichtbar {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.pt-huelle {
		display: none;
	}
	.pt-karte {
		display: grid;
		gap: 0.05rem;
		width: 100%;
		min-height: 2.75rem;
		margin: 0 0 0.25rem;
		padding: 0.3rem 0.4rem;
		border: 1px solid #9fb3cc;
		border-left: 4px solid var(--primaer);
		border-radius: 0.35rem;
		background: #eef3fa;
		color: var(--text);
		font: inherit;
		font-size: 0.8rem;
		line-height: 1.2;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.pt-karte-huelle {
		position: relative;
	}
	/* mehrtägiger Termin: ein durchgehender Balken über die Tage */
	.pt-karte.gruppe {
		background: #dfe9f7;
		border-color: #7d9cc4;
	}
	.seg-anfang .pt-karte {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		margin-right: -0.3rem;
		width: calc(100% + 0.3rem);
	}
	.seg-mitte .pt-karte {
		border-radius: 0;
		border-left-width: 1px;
		margin-left: -0.3rem;
		margin-right: -0.3rem;
		width: calc(100% + 0.6rem);
	}
	.seg-ende .pt-karte {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-left-width: 1px;
		margin-left: -0.3rem;
		width: calc(100% + 0.3rem);
	}
	.pt-karte.ko {
		border-left-color: #6b4fbb;
		background: #efeafb;
	}
	.pt-griff {
		position: absolute;
		top: 0;
		right: -0.3rem;
		width: 1.4rem;
		height: calc(100% - 0.25rem);
		border: 0;
		border-radius: 0 0.35rem 0.35rem 0;
		background: #7d9cc4;
		color: #fff;
		font-size: 0.75rem;
		cursor: ew-resize;
		touch-action: none;
	}
	.pt-ko-chip {
		display: block;
		width: 100%;
		margin: 0 0 0.25rem;
		padding: 0.15rem 0.35rem;
		border: 1px dashed #6b4fbb;
		border-radius: 0.3rem;
		background: #f7f4fd;
		color: #4b3590;
		font: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
	}
	.pt-ko-chip.warn {
		border-color: #d9a400;
	}
	.pt-ko-zeile .pt-name small,
	.pt-ko-zeile .pt-person-kopf small {
		display: block;
		font-weight: 400;
		color: var(--text-leise);
		font-size: 0.72rem;
	}
	.pt-karte.ziehbar {
		touch-action: none;
		user-select: none;
		cursor: grab;
	}
	.pt-karte.warn {
		border: 2px solid #d9a400;
		border-left-width: 5px;
		background: #fff7e0;
	}
	.pt-karte.gezogen {
		opacity: 0.35;
	}
	.pt-zeit {
		font-weight: 700;
	}
	.pt-warnzeichen {
		color: #8a6400;
	}
	.pt-nr,
	.pt-kunde {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pt-nr {
		color: var(--text-leise);
	}
	.pt-abw {
		display: inline-block;
		margin-bottom: 0.25rem;
		padding: 0 0.4rem;
		border-radius: 0.25rem;
		background: #fff;
		color: #6b3b00;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.pt-geist {
		position: fixed;
		z-index: 50;
		display: grid;
		padding: 0.3rem 0.4rem;
		border: 2px solid var(--primaer);
		border-radius: 0.35rem;
		background: #fff;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
		font-size: 0.8rem;
		line-height: 1.2;
		pointer-events: none;
	}
	.abwesend {
		background-image: repeating-linear-gradient(135deg, #f6e7d2 0 6px, #fdf6ec 6px 12px);
	}

	/* Handy */
	.pt-tage {
		display: flex;
		gap: 0.35rem;
		margin: 0 -1rem 0.5rem;
		padding: 0.25rem 1rem;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		list-style: none;
	}
	.pt-tage li {
		flex: none;
	}
	.pt-tage button {
		min-height: 2.75rem;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--rand);
		border-radius: 999px;
		background: #fff;
		color: var(--text);
		white-space: nowrap;
		cursor: pointer;
	}
	.pt-tage button.heute {
		border-color: var(--primaer);
	}
	.pt-tage button[aria-pressed='true'] {
		background: var(--primaer);
		color: #fff;
		font-weight: 700;
	}
	.pt-tagtitel {
		font-size: 1.1rem;
		margin: 0.25rem 0 0.5rem;
	}
	.pt-personen {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.pt-person {
		display: grid;
		gap: 0.25rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
	}
	.pt-person-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem 0.5rem;
	}
	.pt-person .pt-karte {
		font-size: 0.9rem;
	}
	.pt-frei {
		color: var(--text-leise);
		font-size: 0.9rem;
	}
	.pt-plus-mobil {
		min-height: 2.75rem;
		border: 1px dashed var(--primaer);
		border-radius: 0.4rem;
		background: #fff;
		color: var(--primaer);
		font: inherit;
		cursor: pointer;
	}
	.inaktiv {
		color: var(--text-leise);
	}

	/* Ab 700 px: Raster */
	@media (min-width: 700px) {
		.pt-mobil {
			display: none;
		}
		.pt-huelle {
			display: block;
			overflow-x: auto;
			border: 1px solid var(--rand);
			border-radius: 0.5rem;
		}
		.pt-raster {
			width: 100%;
			min-width: 52rem;
			border-collapse: collapse;
			table-layout: fixed;
		}
		.pt-raster th,
		.pt-raster td {
			border: 1px solid var(--rand);
			vertical-align: top;
		}
		.pt-raster thead th {
			padding: 0.4rem 0.3rem;
			background: var(--hintergrund);
			font-size: 0.85rem;
			white-space: nowrap;
		}
		.pt-raster thead th.heute {
			background: var(--primaer);
			color: #fff;
		}
		.pt-ecke {
			width: 9rem;
			text-align: left;
		}
		.pt-name {
			position: sticky;
			left: 0;
			z-index: 1;
			padding: 0.4rem;
			background: #fff;
			font-size: 0.85rem;
			text-align: left;
		}
		.pt-zelle {
			height: 5.5rem;
			padding: 0.25rem;
		}
		.pt-zelle:not(.abwesend) {
			background: #fff;
		}
		.pt-zelle.heute:not(.abwesend) {
			background: #f5f8fc;
		}
		.pt-zelle.ziel {
			outline: 3px solid var(--fokus);
			outline-offset: -3px;
			background: #e3eefc;
		}
		.pt-zelle {
			position: relative;
		}
		.pt-plus {
			display: block;
			width: 100%;
			min-height: 2.75rem;
			border: 1px dashed transparent;
			border-radius: 0.35rem;
			background: transparent;
			color: transparent;
			font-size: 1.25rem;
			cursor: pointer;
		}
		.pt-zelle:hover .pt-plus,
		.pt-plus:focus-visible {
			border-color: #9fb3cc;
			color: var(--primaer);
		}
		.pt-leer {
			padding: 1rem;
			color: var(--text-leise);
		}
	}
</style>
