<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import EinsatzDialog from '$lib/components/EinsatzDialog.svelte';
	import PlantafelRaster from '$lib/components/PlantafelRaster.svelte';
	import { berlinTag, kalenderwoche, tagDeutsch, tagKurz, tagPlus, verschiebeAufTag } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Einsatz = PageData['woche']['einsaetze'][number];
	type Meldung = { art: 'ok' | 'warnung' | 'fehler'; text: string };

	const WARN = { doppelt: 'Doppelbelegung', urlaub: 'Urlaub', krank: 'Krankheit', sonstiges: 'Abwesenheit' } as const;

	let meldung = $state<Meldung | null>(null);
	let dialog = $state<{ einsatz: Einsatz | null; vorbelegung: { tag: string; benutzerId: string } | null } | null>(null);
	/** Sofort angezeigte Verschiebungen, bis die Woche neu geladen ist (bei Fehler zurück an die alte Stelle). */
	let verschoben = $state<Record<string, { beginn: string; ende: string; benutzerId: string }>>({});

	const tage = $derived(data.woche.tage);
	const einsaetze = $derived(data.woche.einsaetze.map((e) => (verschoben[e.id] ? { ...e, ...verschoben[e.id] } : e)));
	const aktive = $derived(data.woche.mitarbeiter.filter((m) => m.aktiv));
	const zeitraum = $derived(`${tagDeutsch(tage[0]).slice(0, 6)}–${tagDeutsch(tage[6])}`);

	/** „Achtung: Doppelbelegung bei Ali am Di 20.10.“ – oder null ohne Warnung. */
	function warnMeldung(e: Einsatz): Meldung | null {
		if (!e.warnungen?.length) return null;
		const arten = [...new Set(e.warnungen.map((w) => WARN[w.art]))].join(' und ');
		return { art: 'warnung', text: `Achtung: ${arten} bei ${e.benutzerName} am ${tagKurz(berlinTag(new Date(e.beginn)))}.` };
	}

	async function verschieben(e: Einsatz, zielTag: string, benutzerId: string) {
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

<main class="kd-seite pt-seite">
	<div class="pt-kopfzeile">
		<h1>Plantafel</h1>
		<p class="kd-info">KW {kalenderwoche(tage[0])} · {zeitraum}</p>
	</div>

	<nav class="pt-wochen" aria-label="Woche wählen">
		<a href={`/plantafel?tag=${tagPlus(tage[0], -7)}`} class="kd-knopf hell">← Woche zurück</a>
		<a href="/plantafel" class="kd-knopf hell" aria-current={tage.includes(data.heute) ? 'true' : undefined}>Heute</a>
		<a href={`/plantafel?tag=${tagPlus(tage[0], 7)}`} class="kd-knopf hell">Woche vor →</a>
	</nav>

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
		onverschieben={verschieben}
		onzelle={(tag, benutzerId) => (dialog = { einsatz: null, vorbelegung: { tag, benutzerId } })}
		oneinsatz={(e) => (dialog = { einsatz: e, vorbelegung: null })}
	/>

	{#if data.darfPlanen}
		<p class="kd-info pt-hilfe">
			Kärtchen auf einen anderen Tag oder Mitarbeiter ziehen, um den Einsatz zu verschieben. Antippen öffnet den
			Einsatz (auch mit Tastatur: Kärtchen wählen, Enter). Warnungen sind gelb umrandet.
		</p>
		<a href="/plantafel/abwesenheiten" class="kd-knopf hell">Abwesenheiten (Urlaub, Krank)</a>
	{/if}

	{#if dialog}
		{#key dialog}
			<EinsatzDialog
				einsatz={dialog.einsatz}
				vorbelegung={dialog.vorbelegung}
				mitarbeiter={aktive}
				auftraege={data.auftraege}
				onfertig={fertig}
				onschliessen={() => (dialog = null)}
			/>
		{/key}
	{/if}
</main>

<style>
	.pt-seite {
		max-width: 80rem;
	}
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
	@media (min-width: 30rem) {
		.pt-wochen {
			grid-template-columns: max-content max-content max-content;
		}
	}
</style>
