<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import EinsatzDialog from '$lib/components/EinsatzDialog.svelte';
	import PlantafelRaster from '$lib/components/PlantafelRaster.svelte';
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
	const mitFilter = (tag: string) => {
		const u = new URLSearchParams(page.url.search);
		u.set('tag', tag);
		return `/plantafel?${u.toString()}`;
	};
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
	const zeitraum = $derived(`${tagDeutsch(tage[0]).slice(0, 6)}–${tagDeutsch(tage[6])}`);

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
			<p class="seiten-meta">KW {kalenderwoche(tage[0])} · {zeitraum}</p>
		</div>
	</header>

	<nav class="pt-wochen" aria-label="Woche wählen">
		<a href={mitFilter(tagPlus(tage[0], -7))} class="kd-knopf hell">← Woche zurück</a>
		<a href={mitFilter(data.heute)} class="kd-knopf hell" aria-current={tage.includes(data.heute) ? 'true' : undefined}>Heute</a>
		<a href={mitFilter(tagPlus(tage[0], 7))} class="kd-knopf hell">Woche vor →</a>
	</nav>

	<details class="pt-filter">
		<summary class="kd-knopf hell">Filter{filterAnzahl > 0 ? ` (${filterAnzahl})` : ''}</summary>
		<div class="pt-filter-inhalt">
			{#if data.kolonnen.length > 0}
				<fieldset>
					<legend>Kolonnen</legend>
					{#each data.kolonnen as ko (ko.id)}
						<label class="kd-haken">
							<input type="checkbox" checked={data.filter.ko.includes(ko.id)} onchange={(ev) => filterSetzen('ko', ko.id, ev.currentTarget.checked)} />
							<span>{ko.name}</span>
						</label>
					{/each}
				</fieldset>
			{/if}
			<fieldset>
				<legend>Mitarbeiter</legend>
				{#each data.alleMitarbeiter as m (m.id)}
					<label class="kd-haken">
						<input type="checkbox" checked={data.filter.ma.includes(m.id)} onchange={(ev) => filterSetzen('ma', m.id, ev.currentTarget.checked)} />
						<span>{m.name}</span>
					</label>
				{/each}
			</fieldset>
			{#if filterAnzahl > 0}<button type="button" class="kd-knopf hell" onclick={filterLeeren}>Filter aufheben</button>{/if}
		</div>
	</details>

	{#if meldung}
		<p class={`pt-meldung ${meldung.art}`} role={meldung.art === 'ok' ? 'status' : 'alert'}>{meldung.text}</p>
	{/if}

	{#if !data.darfPlanen}
		<p class="kd-info">Nur Ansicht – Einsätze planen kann, wer die Plantafel bearbeiten darf.</p>
	{/if}

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

	{#if data.darfPlanen}
		<p class="kd-info pt-hilfe">
			Am PC und Tablet: Kärtchen auf einen anderen Tag oder Mitarbeiter ziehen, um den Einsatz zu verschieben. Mehrtägige
			Termine sind ein Balken über die Tage: ziehen verschiebt den ganzen Termin, der Griff „⇥“ am Ende verlängert oder kürzt ihn.
			Antippen öffnet den Einsatz – dort lassen sich auch Tag und Mitarbeiter ändern (auch mit Tastatur: Kärtchen
			wählen, Enter). Warnungen sind gelb umrandet.
		</p>
		<div class="pt-links">
			<a href="/plantafel/abwesenheiten" class="kd-knopf hell">Abwesenheiten (Urlaub, Krank)</a>
			<a href="/plantafel/kolonnen" class="kd-knopf hell">Kolonnen</a>
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
	.pt-filter {
		margin: 0 0 0.75rem;
	}
	.pt-filter > summary {
		display: inline-flex;
		list-style: none;
		cursor: pointer;
	}
	.pt-filter > summary::-webkit-details-marker {
		display: none;
	}
	.pt-filter-inhalt {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-start;
		margin-top: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.pt-filter fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		min-width: 12rem;
	}
	.pt-filter legend {
		font-weight: 600;
		font-size: 0.875rem;
		margin-bottom: 0.25rem;
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
