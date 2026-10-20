<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import EinsatzDialog from '$lib/components/EinsatzDialog.svelte';
	import PlantafelRaster from '$lib/components/PlantafelRaster.svelte';
	import PlantafelKalender from '$lib/components/PlantafelKalender.svelte';
	import { ANSICHT_NAMEN, ANSICHTEN, monatName, termineAus, terminFarbe, type Ansicht, type KalTermin } from '$lib/kalender';
	import { monatPlus } from '$lib/auslastung';
	import { berlinTag, kalenderwoche, tagDeutsch, tagKurz, tagPlus, verschiebeAufTag } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Einsatz = PageData['woche']['einsaetze'][number];
	type Meldung = { art: 'ok' | 'warnung' | 'fehler'; text: string };

	const WARN = { doppelt: 'Doppelbelegung', urlaub: 'Urlaub', krank: 'Krankheit', sonstiges: 'Abwesenheit' } as const;

	let meldung = $state<Meldung | null>(null);
	let dialog = $state<{ einsatz: Einsatz | null; vorbelegung: { tag: string; benutzerId: string; kolonneId?: string } | null } | null>(null);
	/** Sofort angezeigte Verschiebungen, bis die Woche neu geladen ist (bei Fehler zurück an die alte Stelle). */
	let verschoben = $state<Record<string, { beginn: string; ende: string; benutzerId: string }>>({});

	const tage = $derived(data.woche.tage);
	const einsaetze = $derived(data.woche.einsaetze.map((e) => (verschoben[e.id] ? { ...e, ...verschoben[e.id] } : e)));
	const aktive = $derived(data.alleMitarbeiter);
	const filterAnzahl = $derived(data.filter.ma.length + data.filter.ko.length);
	const kalender = $derived(data.ansicht !== 'team');

	// Kalender (Wunsch Jamil msg 2676): Termine, gewählter Tag, Farben
	const termine = $derived(termineAus(einsaetze));
	// Gewählter Tag: aus der Adresse (auch beim Server-Rendern), bei neuer Adresse neu gesetzt
	let gewaehlt = $state(untrack(() => data.tag));
	$effect.pre(() => {
		gewaehlt = data.tag;
	});
	const reihenfolge = $derived({ personen: data.alleMitarbeiter.map((m) => m.id), kolonnen: data.kolonnen.map((k) => k.id) });
	const farbeVon = (t: KalTermin<Einsatz>) => terminFarbe(t, data.farbe === 'status' ? 'status' : 'person', reihenfolge);

	/** Adresse mit geänderten Parametern (Filter bleiben). */
	function adresse(aenderung: Record<string, string | null>) {
		const u = new URLSearchParams(page.url.search);
		for (const [k, v] of Object.entries(aenderung)) {
			if (v === null) u.delete(k);
			else u.set(k, v);
		}
		const q = u.toString();
		return q ? `/plantafel?${q}` : '/plantafel';
	}
	const schritt = (richtung: number) => {
		if (data.ansicht === 'monat') return adresse({ tag: `${monatPlus(data.monat, richtung)}-01` });
		if (data.ansicht === 'tag') return adresse({ tag: tagPlus(data.tag, richtung) });
		return adresse({ tag: tagPlus(tage[0], 7 * richtung) });
	};
	const SCHRITT_NAMEN: Record<Ansicht, [string, string]> = {
		monat: ['← Monat', 'Monat →'],
		woche: ['← Woche', 'Woche →'],
		tag: ['← Tag', 'Tag →'],
		team: ['← Woche zurück', 'Woche vor →']
	};
	const titel = $derived(
		data.ansicht === 'monat'
			? monatName(data.monat)
			: data.ansicht === 'tag'
				? tagDeutsch(data.tag)
				: `KW ${kalenderwoche(tage[0])} · ${tagDeutsch(tage[0]).slice(0, 6)}–${tagDeutsch(tage[6])}`
	);
	const istGewaehlt = (art: 'ma' | 'ko', id: string) => (art === 'ma' ? data.filter.ma : data.filter.ko).includes(id);

	function neuerTermin(tag: string) {
		dialog = { einsatz: null, vorbelegung: { tag, benutzerId: data.filter.ma[0] ?? aktive[0]?.id ?? '', kolonneId: data.filter.ko[0] } };
	}
	const einsatzAm = (t: KalTermin<Einsatz>, tag: string) => t.einsaetze.find((e) => berlinTag(new Date(e.beginn)) === tag) ?? t.einsaetze[0];
	function kalenderVerschieben(t: KalTermin<Einsatz>, vonTag: string, nachTag: string) {
		const e = einsatzAm(t, vonTag);
		if (t.gruppeId) {
			const n = tageZwischen(vonTag, nachTag);
			return gruppeAnfrage(e, { tage: n }, `Termin um ${Math.abs(n)} Tag${Math.abs(n) === 1 ? '' : 'e'} verschoben.`);
		}
		return verschieben(e, nachTag, e.benutzerId);
	}

	/** Filter in der Adresse ändern (Woche bleibt). */
	function filterSetzen(art: 'ma' | 'ko', id: string, an: boolean) {
		const u = new URL(page.url);
		const alt = u.searchParams.getAll(art).filter((x) => x !== id);
		u.searchParams.delete(art);
		for (const x of an ? [...alt, id] : alt) u.searchParams.append(art, x);
		goto(`${u.pathname}${u.search}`, { keepFocus: true, noScroll: true });
	}
	function filterLeeren() {
		const u = new URL(page.url);
		u.searchParams.delete('ma');
		u.searchParams.delete('ko');
		goto(`${u.pathname}${u.search}`, { keepFocus: true, noScroll: true });
	}
	const tageZwischen = (von: string, bis: string) => Math.round((Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) / 86_400_000);

	async function gruppeAnfrage(e: Einsatz, koerper: Record<string, unknown>, ok: string) {
		meldung = null;
		try {
			const r = await fetch(`/api/einsatz-gruppen/${e.gruppe!.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(koerper)
			});
			const antwort = await r.json().catch(() => null);
			if (!r.ok) {
				meldung = { art: 'fehler', text: antwort?.fehler ?? 'Hat nicht geklappt.' };
				return;
			}
			const warn = (antwort as Einsatz[]).find((x) => x.warnungen?.length);
			meldung = (warn && warnMeldung(warn)) ?? { art: 'ok', text: ok };
			await invalidateAll();
		} catch {
			meldung = { art: 'fehler', text: 'Keine Verbindung – der Termin bleibt an seiner Stelle.' };
		}
	}

	/** „Achtung: Doppelbelegung bei Ali am Di 20.10.“ – oder null ohne Warnung. */
	function warnMeldung(e: Einsatz): Meldung | null {
		if (!e.warnungen?.length) return null;
		const arten = [...new Set(e.warnungen.map((w) => WARN[w.art]))].join(' und ');
		return { art: 'warnung', text: `Achtung: ${arten} bei ${e.benutzerName} am ${tagKurz(berlinTag(new Date(e.beginn)))}.` };
	}

	async function verschieben(e: Einsatz, zielTag: string, benutzerId: string) {
		// Mehrtägiger Termin / Kolonne: die ganze Gruppe tageweise verschieben (Person bleibt)
		if (e.gruppe) {
			const tage = tageZwischen(berlinTag(new Date(e.beginn)), zielTag);
			if (tage === 0) {
				meldung = { art: 'warnung', text: 'Mehrtägige Termine und Kolonnen werden nur tageweise verschoben – einzelne Personen im Termin ändern.' };
				return;
			}
			return gruppeAnfrage(e, { tage }, `Termin um ${Math.abs(tage)} Tag${Math.abs(tage) === 1 ? '' : 'e'} verschoben.`);
		}
		if (benutzerId.startsWith('ko:')) {
			meldung = { art: 'warnung', text: 'Einzelne Einsätze lassen sich nicht in eine Kolonnen-Zeile ziehen – Kolonne über „+“ einplanen.' };
			return;
		}
		const neu = verschiebeAufTag(new Date(e.beginn), new Date(e.ende), zielTag);
		const ziel = { beginn: neu.beginn.toISOString(), ende: neu.ende.toISOString(), benutzerId };
		verschoben[e.id] = ziel;
		meldung = null;
		try {
			const r = await fetch(`/api/einsaetze/${e.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(ziel)
			});
			const antwort = await r.json().catch(() => null);
			if (!r.ok) {
				delete verschoben[e.id];
				meldung = { art: 'fehler', text: antwort?.fehler ?? 'Verschieben hat nicht geklappt.' };
				return;
			}
			meldung = warnMeldung(antwort) ?? {
				art: 'ok',
				text: `Verschoben: ${antwort.benutzerName} am ${tagKurz(berlinTag(new Date(antwort.beginn)))}.`
			};
			await invalidateAll();
			delete verschoben[e.id];
		} catch {
			delete verschoben[e.id];
			meldung = { art: 'fehler', text: 'Keine Verbindung – der Einsatz bleibt an seiner Stelle.' };
		}
	}

	async function fertig(ergebnis: { aktion: 'angelegt' | 'geaendert' | 'geloescht'; einsatz: Einsatz }) {
		dialog = null;
		meldung =
			ergebnis.aktion === 'geloescht'
				? { art: 'ok', text: 'Einsatz gelöscht.' }
				: (warnMeldung(ergebnis.einsatz) ?? {
						art: 'ok',
						text: ergebnis.aktion === 'angelegt' ? 'Einsatz angelegt.' : 'Einsatz gespeichert.'
					});
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Plantafel</title>
</svelte:head>

<main class="kd-seite breit pt-seite">
	<header class="seiten-kopf pt-kopfzeile">
		<div>
			<h1>Plantafel</h1>
			<p class="seiten-meta pt-titel">{titel}</p>
		</div>
		<nav class="pt-ansicht" aria-label="Ansicht">
			{#each ANSICHTEN as a (a)}
				<a href={adresse({ ansicht: a === 'monat' ? null : a })} aria-current={data.ansicht === a ? 'page' : undefined}>{ANSICHT_NAMEN[a]}</a>
			{/each}
		</nav>
	</header>

	<nav class="pt-wochen" aria-label="Zeitraum wählen">
		<a href={schritt(-1)} class="kd-knopf hell">{SCHRITT_NAMEN[data.ansicht][0]}</a>
		<a href={adresse({ tag: data.heute })} class="kd-knopf hell" aria-current={tage.includes(data.heute) ? 'true' : undefined}>Heute</a>
		<a href={schritt(1)} class="kd-knopf hell">{SCHRITT_NAMEN[data.ansicht][1]}</a>
	</nav>

	<div class="pt-chips" role="group" aria-label="Filter Mitarbeiter und Kolonnen">
		<button type="button" class="pt-chip" aria-pressed={filterAnzahl === 0} onclick={filterLeeren}>Alle</button>
		{#each data.kolonnen as ko (ko.id)}
			<button type="button" class="pt-chip ko" aria-pressed={istGewaehlt('ko', ko.id)} onclick={() => filterSetzen('ko', ko.id, !istGewaehlt('ko', ko.id))}>
				<span class="pt-punkt" style:background={terminFarbe({ kolonne: ko, personen: [], status: '' }, 'person', reihenfolge)}></span>{ko.name}
			</button>
		{/each}
		{#each data.alleMitarbeiter as m (m.id)}
			<button type="button" class="pt-chip" aria-pressed={istGewaehlt('ma', m.id)} onclick={() => filterSetzen('ma', m.id, !istGewaehlt('ma', m.id))}>
				<span class="pt-punkt" style:background={terminFarbe({ kolonne: null, personen: [{ id: m.id, name: m.name }], status: '' }, 'person', reihenfolge)}></span>{m.name}
			</button>
		{/each}
	</div>

	{#if kalender}
		<div class="pt-farbe" role="group" aria-label="Farbe nach">
			<span class="kd-info">Farbe:</span>
			<a href={adresse({ farbe: null })} aria-current={data.farbe !== 'status' ? 'true' : undefined}>Mitarbeiter/Kolonne</a>
			<a href={adresse({ farbe: 'status' })} aria-current={data.farbe === 'status' ? 'true' : undefined}>Status</a>
		</div>
	{/if}

	{#if meldung}
		<p class={`pt-meldung ${meldung.art}`} role={meldung.art === 'ok' ? 'status' : 'alert'}>{meldung.text}</p>
	{/if}

	{#if !data.darfPlanen}
		<p class="kd-info">Nur Ansicht – Einsätze planen kann, wer die Plantafel bearbeiten darf. <a href="/plantafel/auslastung">Auslastung ansehen</a></p>
	{/if}

	{#if data.ansicht !== 'team'}
		<PlantafelKalender
			ansicht={data.ansicht}
			wochen={data.wochen}
			monat={data.monat}
			heute={data.heute}
			{termine}
			farbe={farbeVon}
			darfPlanen={data.darfPlanen}
			bind:gewaehlt
			onbearbeiten={(t, tag) => (dialog = { einsatz: einsatzAm(t, tag), vorbelegung: null })}
			onverschieben={kalenderVerschieben}
			onverlaengern={(t, bisTag) => gruppeAnfrage(t.einsaetze[0], { bisTag }, `Termin geht jetzt bis ${tagKurz(bisTag)}.`)}
			onneu={neuerTermin}
		/>
		{#if data.darfPlanen}
			<button type="button" class="pt-neu" onclick={() => neuerTermin(gewaehlt || data.heute)} aria-label={`Neuer Termin am ${tagKurz(gewaehlt || data.heute)}`}>
				<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="3" y="5" width="15" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 9h15M7 3v4M14 3v4" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="18" cy="18" r="5" fill="currentColor"/><path d="M18 15.5v5M15.5 18h5" stroke="#fff" stroke-width="1.7"/></svg>
			</button>
		{/if}
	{:else}
	<PlantafelRaster
		{tage}
		heute={data.heute}
		mitarbeiter={data.woche.mitarbeiter}
		{einsaetze}
		abwesenheiten={data.woche.abwesenheiten}
		darfPlanen={data.darfPlanen}
		kolonnen={data.sichtbareKolonnen}
		onverschieben={verschieben}
		onverlaengern={(e, bisTag) => gruppeAnfrage(e, { bisTag }, `Termin geht jetzt bis ${tagKurz(bisTag)}.`)}
		onzelle={(tag, benutzerId) => (dialog = { einsatz: null, vorbelegung: { tag, benutzerId } })}
		onkolonne={(tag, kolonneId) => (dialog = { einsatz: null, vorbelegung: { tag, benutzerId: aktive[0]?.id ?? '', kolonneId } })}
		oneinsatz={(e) => (dialog = { einsatz: e, vorbelegung: null })}
	/>
	{/if}

	{#if data.darfPlanen}
		<p class="kd-info pt-hilfe">
			{#if kalender}
				Tag antippen zeigt seine Termine darunter; Termin antippen öffnet den Auftrag, „Bearbeiten“ den Einsatz. „+“ legt einen
				Termin am gewählten Tag an. Am PC: Balken mit der Maus auf einen anderen Tag ziehen verschiebt den Termin, der Griff
				„⇥“ am Ende eines mehrtägigen Termins verlängert oder kürzt ihn. Warnungen sind gelb umrandet.
			{:else}
				Am PC und Tablet: Kärtchen auf einen anderen Tag oder Mitarbeiter ziehen, um den Einsatz zu verschieben. Mehrtägige
				Termine sind ein Balken über die Tage: ziehen verschiebt den ganzen Termin, der Griff „⇥“ am Ende verlängert oder kürzt ihn.
				Antippen öffnet den Einsatz – dort lassen sich auch Tag und Mitarbeiter ändern (auch mit Tastatur: Kärtchen
				wählen, Enter). Warnungen sind gelb umrandet.
			{/if}
		</p>
		<div class="pt-links">
			<a href="/plantafel/abwesenheiten" class="kd-knopf hell">Abwesenheiten (Urlaub, Krank)</a>
			<a href="/plantafel/kolonnen" class="kd-knopf hell">Kolonnen</a>
			<a href="/plantafel/auslastung" class="kd-knopf hell">Auslastung</a>
		</div>
	{/if}

	{#if dialog}
		{#key dialog}
			<EinsatzDialog
				einsatz={dialog.einsatz}
				vorbelegung={dialog.vorbelegung}
				mitarbeiter={aktive}
				auftraege={data.auftraege}
				kolonnen={data.kolonnen}
				onfertig={fertig}
				onschliessen={() => (dialog = null)}
			/>
		{/key}
	{/if}
</main>

<style>
	.pt-kopfzeile {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 1rem;
	}
	.pt-kopfzeile h1 {
		margin-bottom: 0.25rem;
	}
	.pt-wochen {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0.5rem 0 0.75rem;
	}
	.pt-wochen a {
		padding-inline: 0.4rem;
		font-size: 0.9rem;
		text-align: center;
	}
	.pt-meldung {
		margin: 0 0 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: 0.4rem;
		border-left: 5px solid;
	}
	.pt-meldung.ok {
		background: #e2f3ec;
		border-color: #1f8a4c;
	}
	.pt-meldung.warnung {
		background: #fff7e0;
		border-color: #d9a400;
	}
	.pt-meldung.fehler {
		background: #fde8ea;
		border-color: var(--fehler);
	}
	.pt-hilfe {
		margin-top: 0.75rem;
	}
	.pt-ansicht {
		display: inline-flex;
		border: 1px solid var(--m365-rand-stark, #8a8886);
		border-radius: 999px;
		overflow: hidden;
	}
	.pt-ansicht a {
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0 0.9rem;
		color: inherit;
		text-decoration: none;
		font-size: 0.9rem;
	}
	.pt-ansicht a + a {
		border-left: 1px solid var(--m365-rand, #e1dfdd);
	}
	.pt-ansicht a[aria-current='page'] {
		background: var(--m365-primaer, #0f6cbd);
		color: #fff;
		font-weight: 600;
	}
	.pt-chips {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding: 0.1rem 0 0.5rem;
		margin: 0 0 0.25rem;
		scrollbar-width: thin;
	}
	.pt-chip {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.5rem;
		padding: 0 0.85rem;
		border: 1px solid var(--m365-rand-stark, #8a8886);
		border-radius: 999px;
		background: var(--m365-flaeche, #fff);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.pt-chip[aria-pressed='true'] {
		background: var(--m365-primaer, #0f6cbd);
		border-color: var(--m365-primaer, #0f6cbd);
		color: #fff;
		font-weight: 600;
	}
	.pt-chip.ko {
		font-weight: 600;
	}
	.pt-punkt {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		box-shadow: 0 0 0 1px #fff;
	}
	.pt-farbe {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		margin: 0 0 0.75rem;
		font-size: 0.875rem;
	}
	.pt-farbe a[aria-current='true'] {
		font-weight: 700;
		color: inherit;
		text-decoration: none;
	}
	.pt-neu {
		position: fixed;
		z-index: 20;
		right: 5.5rem;
		bottom: calc(var(--nav-hoehe) + 0.75rem + env(safe-area-inset-bottom));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3.75rem;
		height: 3.75rem;
		border: 1px solid var(--m365-rand, #e1dfdd);
		border-radius: 1rem;
		background: #fff;
		color: var(--m365-primaer, #0f6cbd);
		box-shadow: 0 4px 14px rgb(5 52 107 / 0.25);
		cursor: pointer;
	}
	.pt-neu:hover {
		background: #eaf2fb;
	}
	.pt-titel {
		font-size: 1.25rem;
		font-weight: 600;
		color: inherit;
	}
	.pt-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	@media (min-width: 30rem) {
		.pt-wochen {
			grid-template-columns: max-content max-content max-content;
		}
	}
</style>
