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
		onverschieben,
		onzelle,
		oneinsatz
	}: {
		tage: string[];
		heute: string;
		mitarbeiter: Mitarbeiter[];
		einsaetze: Einsatz[];
		abwesenheiten: Abwesenheit[];
		darfPlanen: boolean;
		onverschieben: (e: Einsatz, tag: string, benutzerId: string) => void;
		onzelle: (tag: string, benutzerId: string) => void;
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

	/** Einsätze je „Mitarbeiter|Tag“. */
	const zellen = $derived.by(() => {
		const m = new Map<string, Einsatz[]>();
		for (const e of einsaetze) {
			const schluessel = `${e.benutzerId}|${tagVon(e)}`;
			m.set(schluessel, [...(m.get(schluessel) ?? []), e]);
		}
		return m;
	});
	const inZelle = (benutzerId: string, tag: string) => zellen.get(`${benutzerId}|${tag}`) ?? [];
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
	};
	let zug = $state<Zug | null>(null);
	let klickSperre = false;

	function zelleBei(x: number, y: number): { tag: string; benutzerId: string } | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-zelle]');
		return el?.dataset.tag && el.dataset.benutzer ? { tag: el.dataset.tag, benutzerId: el.dataset.benutzer } : null;
	}

	function runter(ev: PointerEvent, e: Einsatz) {
		if (!darfPlanen || !ev.isPrimary || ev.button !== 0) return;
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
			ziel: null
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

{#snippet karte(e: Einsatz, ziehbar: boolean)}
	{#if darfPlanen}
		<button
			type="button"
			class="pt-karte"
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
			<span class="pt-zeit">{zeit(e)}{#if e.warnungen.length > 0}<span class="pt-warnzeichen" aria-hidden="true"> ⚠</span>{/if}</span>
			<span class="pt-nr">{e.auftragNummer}</span>
			<span class="pt-kunde">{e.kundeName}</span>
		</button>
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
								{@render karte(e, true)}
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
		{#each mitarbeiter as m (m.id)}
			{@const abw = abwesenheitAm(m.id, tagMobil)}
			{@const liste = inZelle(m.id, tagMobil)}
			<li class="pt-person" class:abwesend={abw !== null}>
				<div class="pt-person-kopf">
					<strong class:inaktiv={!m.aktiv}>{m.name}</strong>
					{#if abw}<span class="pt-abw">{ABW_NAMEN[abw.art]}</span>{/if}
				</div>
				{#each liste as e (e.id)}
					{@render karte(e, false)}
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
