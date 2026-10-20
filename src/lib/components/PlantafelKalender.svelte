<script lang="ts" generics="E extends KalEinsatz">
	/**
	 * Plantafel als Kalender (Wunsch Jamil msg 2676, Vorbild Outlook-Monatsansicht am Handy).
	 * - Monat: Raster Mo–So, Tageszahlen, Termine als farbige Balken – mehrtägige durchgehend über die Tage (und
	 *   über Wochengrenzen mit „geht weiter“-Kante). Pro Tag höchstens 3 Balken, sonst „+n“.
	 * - Woche: eine Woche, höhere Balken mit Uhrzeit und allen Terminen.
	 * - Tag: Liste mit großen Tippflächen.
	 * Tag antippen → Liste darunter (Termin antippen öffnet den Auftrag, „Bearbeiten“ den Einsatz).
	 * Am PC (Maus): Balken auf einen anderen Tag ziehen verschiebt den Termin; der Griff „⇥“ am Ende eines
	 * mehrtägigen Termins verlängert/kürzt ihn. Am Handy: antippen, dann bearbeiten.
	 */
	import { balkenDerWoche, termineAm, type KalEinsatz, type KalTermin } from '$lib/kalender';
	import { tagKurz } from '$lib/zeit';

	let {
		ansicht,
		wochen,
		monat,
		heute,
		termine,
		farbe,
		darfPlanen,
		gewaehlt = $bindable(),
		onbearbeiten,
		onverschieben,
		onverlaengern,
		onneu
	}: {
		ansicht: 'monat' | 'woche' | 'tag';
		wochen: string[][];
		monat: string;
		heute: string;
		termine: KalTermin<E>[];
		farbe: (t: KalTermin<E>) => string;
		darfPlanen: boolean;
		gewaehlt: string;
		onbearbeiten: (t: KalTermin<E>, tag: string) => void;
		onverschieben: (t: KalTermin<E>, vonTag: string, nachTag: string) => void;
		onverlaengern: (t: KalTermin<E>, bisTag: string) => void;
		onneu: (tag: string) => void;
	} = $props();

	const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
	const MONATE_KURZ = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
	const MAX_SPUREN = $derived(ansicht === 'monat' ? 3 : 99);
	const zahl = (tag: string) => {
		const t = Number(tag.slice(8, 10));
		return t === 1 ? `${t}. ${MONATE_KURZ[Number(tag.slice(5, 7)) - 1]}` : String(t);
	};
	const personenText = (t: KalTermin<E>) => (t.kolonne ? t.kolonne.name : t.personen.map((p) => p.name.split(' ')[0]).join(', '));
	const tagesListe = $derived(termineAm(gewaehlt, termine));

	// ——— Ziehen am PC (nur Maus/Stift; Finger tippt) ———
	type Zug = { termin: KalTermin<E>; art: 'schieben' | 'griff'; vonTag: string; x: number; y: number; aktiv: boolean; ziel: string | null };
	let zug = $state<Zug | null>(null);
	let klickSperre = false;
	function tagUnter(x: number, y: number): string | null {
		const el = document.elementFromPoint(x, y)?.closest('[data-tag]') as HTMLElement | null;
		return el?.dataset.tag ?? null;
	}
	function runter(ev: PointerEvent, t: KalTermin<E>, art: Zug['art'], tag: string) {
		if (!darfPlanen || ev.pointerType === 'touch' || ev.button !== 0) return;
		if (art === 'griff') ev.preventDefault();
		zug = { termin: t, art, vonTag: tag, x: ev.clientX, y: ev.clientY, aktiv: false, ziel: null };
		window.addEventListener('pointermove', bewegen);
		window.addEventListener('pointerup', hoch, { once: true });
	}
	function bewegen(ev: PointerEvent) {
		if (!zug) return;
		if (!zug.aktiv && Math.hypot(ev.clientX - zug.x, ev.clientY - zug.y) < 6) return;
		zug.aktiv = true;
		zug.ziel = tagUnter(ev.clientX, ev.clientY);
	}
	function hoch() {
		window.removeEventListener('pointermove', bewegen);
		const z = zug;
		zug = null;
		if (!z?.aktiv || !z.ziel) return;
		klickSperre = true;
		setTimeout(() => (klickSperre = false), 0);
		if (z.art === 'griff') {
			if (z.ziel !== z.termin.bisTag && z.ziel >= z.termin.vonTag) onverlaengern(z.termin, z.ziel);
		} else if (z.ziel !== z.vonTag) onverschieben(z.termin, z.vonTag, z.ziel);
	}
	const klick = (ev: MouseEvent) => {
		if (klickSperre) ev.preventDefault();
	};
	/** Tag, an dem der Balken in dieser Woche beginnt (für die Verschiebung: Ziel − dieser Tag). */
	const balkenTag = (woche: string[], start: number) => woche[start];
</script>

{#snippet wochenZeile(woche: string[], hoch: boolean)}
	{@const balken = balkenDerWoche(woche, termine)}
	{@const spuren = Math.min(MAX_SPUREN, Math.max(0, ...balken.map((b) => b.spur + 1)))}
	<div class="kal-woche" class:hoch style:--spuren={spuren}>
		{#each woche as tag, i (tag)}
			{@const versteckt = balken.filter((b) => b.spur >= MAX_SPUREN && b.start <= i && b.start + b.laenge > i).length}
			<button
				type="button"
				class="kal-tag"
				class:anderer={ansicht === 'monat' && !tag.startsWith(monat)}
				class:heute={tag === heute}
				class:gewaehlt={tag === gewaehlt}
				class:ziel={zug?.aktiv && zug.ziel === tag}
				style:grid-column={i + 1}
				data-tag={tag}
				aria-label={`${tagKurz(tag)}${termineAm(tag, termine).length ? `, ${termineAm(tag, termine).length} Termin(e)` : ''}`}
				aria-pressed={tag === gewaehlt}
				onclick={() => (gewaehlt = tag)}
			>
				<span class="kal-zahl">{hoch ? tagKurz(tag) : zahl(tag)}</span>
				{#if versteckt > 0}<span class="kal-mehr">+{versteckt}</span>{/if}
			</button>
		{/each}
		{#each balken.filter((b) => b.spur < MAX_SPUREN) as b (b.termin.id)}
			{@const t = b.termin}
			<a
				href={`/auftraege/${t.auftragId}`}
				class="kal-balken"
				class:links={b.weiterLinks}
				class:rechts={b.weiterRechts}
				class:warnung={t.warnung}
				class:gezogen={zug?.aktiv && zug.termin.id === t.id}
				style:grid-column={`${b.start + 1} / span ${b.laenge}`}
				style:grid-row={b.spur + 2}
				style:--farbe={farbe(t)}
				title={`${t.zeit} · ${t.titel} – ${t.kundeName} · ${personenText(t)}`}
				draggable="false"
				onpointerdown={(ev) => runter(ev, t, 'schieben', balkenTag(woche, b.start))}
				onclick={klick}
			>
				<span class="kal-text">{#if hoch}<b>{t.zeit.slice(0, 5)}</b> {/if}{t.kundeName || t.titel}{#if hoch}{` · ${personenText(t)}`}{/if}</span>
				{#if darfPlanen && t.gruppeId && !b.weiterRechts}
					<span
						class="kal-griff"
						role="presentation"
						title="Ziehen: Termin verlängern oder kürzen"
						onpointerdown={(ev) => {
							ev.stopPropagation();
							runter(ev, t, 'griff', t.bisTag);
						}}>⇥</span
					>
				{/if}
			</a>
		{/each}
	</div>
{/snippet}

{#snippet liste(tag: string, eintraege: KalTermin<E>[])}
	<section class="kal-liste" aria-label={`Termine ${tagKurz(tag)}`}>
		<header>
			<h2>{tagKurz(tag)}{tag === heute ? ' · heute' : ''}</h2>
			{#if darfPlanen}<button type="button" class="kd-knopf hell klein" onclick={() => onneu(tag)}>+ Termin</button>{/if}
		</header>
		{#if eintraege.length === 0}
			<p class="kd-info">Keine Termine.</p>
		{:else}
			<ul>
				{#each eintraege as t (t.id)}
					<li style:--farbe={farbe(t)} class:warnung={t.warnung}>
						<a href={`/auftraege/${t.auftragId}`} class="kal-eintrag">
							<span class="kal-zeit">{t.zeit}{t.vonTag !== t.bisTag ? ` · ${tagKurz(t.vonTag)}–${tagKurz(t.bisTag)}` : ''}</span>
							<strong>{t.titel}</strong>
							<span>{t.kundeName}{t.ort ? ` · ${t.ort}` : ''}</span>
							<span class="kal-wer">{t.kolonne ? `${t.kolonne.name}: ` : ''}{t.personen.map((p) => p.name).join(', ')}{t.warnung ? ' · ⚠ Warnung' : ''}</span>
						</a>
						{#if darfPlanen}
							<button type="button" class="kd-knopf hell klein" onclick={() => onbearbeiten(t, tag)} aria-label={`${t.titel} bearbeiten`}>Bearbeiten</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#if ansicht === 'tag'}
	{@render liste(gewaehlt, termineAm(gewaehlt, termine))}
{:else}
	<div class="kal" class:monat={ansicht === 'monat'}>
		<div class="kal-kopf" aria-hidden="true">{#each WOCHENTAGE as w (w)}<span>{w}</span>{/each}</div>
		{#each wochen as woche (woche[0])}
			{@render wochenZeile(woche, ansicht === 'woche')}
		{/each}
	</div>
	{@render liste(gewaehlt, tagesListe)}
{/if}

<style>
	.kal {
		border: 1px solid var(--m365-rand, #e1dfdd);
		border-radius: var(--m365-radius, 4px);
		background: var(--m365-flaeche, #fff);
		overflow: hidden;
		user-select: none;
	}
	.kal-kopf {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		border-bottom: 1px solid var(--m365-rand, #e1dfdd);
	}
	.kal-kopf span {
		padding: 0.5rem 0;
		text-align: center;
		font-size: 0.8125rem;
		font-weight: 700;
	}
	.kal-woche {
		position: relative;
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		grid-template-rows: 1.9rem repeat(var(--spuren), 1.45rem) minmax(1.5rem, 1fr);
		row-gap: 2px;
		min-height: 6.25rem;
		border-bottom: 1px solid var(--m365-rand, #e1dfdd);
	}
	.kal-woche:last-child {
		border-bottom: 0;
	}
	.kal-woche.hoch {
		grid-template-rows: 2.25rem repeat(var(--spuren), 2.6rem) minmax(4rem, 1fr);
		min-height: 18rem;
	}
	.kal-tag {
		grid-row: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
		padding: 0.3rem 0 0.2rem;
		border: 0;
		border-right: 1px solid var(--m365-rand, #e1dfdd);
		background: transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.kal-tag:nth-of-type(7) {
		border-right: 0;
	}
	.kal-tag:hover {
		background: var(--m365-flaeche-hover, #f3f2f1);
	}
	.kal-tag.anderer {
		background: #faf9f8;
		color: var(--m365-text-leise, #8a8886);
	}
	.kal-tag.gewaehlt {
		background: #eaf2fb;
		box-shadow: inset 0 0 0 2px var(--m365-primaer, #0f6cbd);
	}
	.kal-tag.ziel {
		background: #dbeafc;
	}
	.kal-zahl {
		font-size: 0.9375rem;
		line-height: 1.4rem;
		min-width: 1.6rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.kal-tag.heute .kal-zahl {
		background: var(--m365-primaer, #0f6cbd);
		color: #fff;
		font-weight: 700;
	}
	.kal-mehr {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--m365-primaer, #0f6cbd);
	}
	.kal-balken {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		min-width: 0;
		margin: 0 3px;
		padding: 0 0.35rem;
		border-radius: 4px;
		background: color-mix(in srgb, var(--farbe) 18%, #fff);
		border-left: 4px solid var(--farbe);
		color: #1c1f23;
		font-size: 0.75rem;
		line-height: 1.2;
		text-decoration: none;
		overflow: hidden;
		cursor: pointer;
	}
	.kal-balken.links {
		margin-left: 0;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-left: 0;
	}
	.kal-balken.rechts {
		margin-right: 0;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.kal-balken.warnung {
		outline: 2px solid #d9a400;
		outline-offset: -2px;
	}
	.kal-balken.gezogen {
		opacity: 0.5;
	}
	.kal-balken:hover,
	.kal-balken:focus-visible {
		background: color-mix(in srgb, var(--farbe) 30%, #fff);
	}
	.kal-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hoch .kal-text {
		white-space: normal;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.kal-griff {
		flex: none;
		padding: 0 0.15rem;
		cursor: ew-resize;
		font-weight: 700;
		color: var(--farbe);
	}
	.kal-liste {
		margin-top: 1rem;
	}
	.kal-liste header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.kal-liste h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.kal-liste ul {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.kal-liste li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0.25rem 0;
		border: 1px solid var(--m365-rand, #e1dfdd);
		border-left: 6px solid var(--farbe);
		border-radius: var(--m365-radius, 4px);
		background: var(--m365-flaeche, #fff);
	}
	.kal-liste li.warnung {
		border-color: #d9a400;
		border-left-color: var(--farbe);
	}
	.kal-eintrag {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.1rem;
		min-height: 3rem;
		padding: 0.45rem 0.6rem;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.kal-eintrag:hover strong {
		text-decoration: underline;
	}
	.kal-zeit,
	.kal-wer {
		font-size: 0.8125rem;
		color: var(--m365-text-leise, #616161);
	}
	@media (max-width: 40rem) {
		.kal-woche {
			min-height: 5.5rem;
			grid-template-rows: 1.8rem repeat(var(--spuren), 1.3rem) minmax(1rem, 1fr);
		}
		.kal-balken {
			margin: 0 1px;
			padding: 0 0.2rem;
			font-size: 0.6875rem;
			border-left-width: 3px;
		}
		.kal-woche.hoch {
			grid-template-rows: 2.25rem repeat(var(--spuren), 3.2rem) minmax(3rem, 1fr);
		}
		.kal-zahl {
			font-size: 0.8125rem;
		}
		.hoch .kal-zahl {
			font-size: 0.6875rem;
			white-space: normal;
			text-align: center;
		}
	}
</style>
