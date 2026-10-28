<script lang="ts">
	import KachelBoard from './KachelBoard.svelte';
	import { STATUS, STATUS_NAMEN, type AuftragStatus } from '$lib/auftrag-status';
	import StatusMenue from './StatusMenue.svelte';
	import {
		aktualisiereKarte,
		initialen,
		kurzAdresse,
		STATUS_FARBEN,
		UNTERGRUPPEN,
		untergruppe,
		verschiebeKarte,
		zielErlaubt,
		type BoardSpalte
	} from '$lib/auftrag-board';
	import type { KachelSpalte } from '$lib/kachel-board';
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
		hatTermin: boolean;
	};

	/**
	 * Auftrags-Board (Kacheln je Status) auf Basis von `KachelBoard`: Ziehen nur in die Nachbarspalte (Statuskette),
	 * immer auch über das Menü „Status ▾“ (Tastatur, Handy). Verschieben ist sofort sichtbar (optimistisch) und wird
	 * bei einem Fehler des Servers zurückgenommen.
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

	const FARBEN = STATUS_FARBEN;
	const kachelSpalten = $derived<KachelSpalte<Karte>[]>(
		spalten.map((s) => ({ id: s.status, titel: STATUS_NAMEN[s.status], farbe: FARBEN[s.status], anzahl: s.anzahl, karten: s.karten }))
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

	function verboten(k: Karte, _von: string, nach: string) {
		fehler = true;
		meldung = `Nur ein Schritt in der Statuskette: „${STATUS_NAMEN[k.status]}“ kann nicht direkt nach „${STATUS_NAMEN[nach as AuftragStatus]}“.`;
	}

	/** Board: wie beim Ziehen nur ein Schritt (Server-Regel); weitere Sprünge gehen im Auftrag selbst. */
	const grund = (k: Karte) => (nach: AuftragStatus) =>
		STATUS.indexOf(nach) > STATUS.indexOf(k.status) ? 'erst die Schritte davor' : 'nur ein Schritt zurück';
</script>

{#snippet kachel(k: Karte)}
	{@const adresse = kurzAdresse(k.adresse)}
	<div class="ab-inhalt" class:laeuft={laeuft.has(k.id)}>
		<div class="ab-zeile">
			<span class="ab-nummer">{k.nummer}</span>
			{#if darfBearbeiten}
				<StatusMenue
					status={k.status}
					titel={k.titel}
					erlaubt={(nach) => zielErlaubt(k.status, nach)}
					grund={grund(k)}
					gesperrt={laeuft.has(k.id)}
					onwaehle={(nach) => void verschiebe(k, nach)}
				/>
			{/if}
		</div>
		<a href={`/auftraege/${k.id}`} class="ab-titel" draggable="false">{k.titel}</a>
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
	</div>
{/snippet}

{#snippet geist(k: Karte)}
	<span class="ab-nummer">{k.nummer}</span>
	<strong>{k.titel}</strong>
	<span class="ab-kunde">{k.kundeName}</span>
{/snippet}

{#snippet fuss(s: KachelSpalte<Karte>)}
	{#if (s.anzahl ?? 0) > s.karten.length}
		<p class="ab-mehr">
			{s.karten.length} von {s.anzahl} angezeigt –
			<a href={`/auftraege?ansicht=liste&status=${s.id}`}>alle in der Liste</a>
		</p>
	{/if}
{/snippet}

<KachelBoard
	spalten={kachelSpalten}
	ziehbar={() => darfBearbeiten}
	zielErlaubt={(k, _von, nach) => zielErlaubt(k.status, nach as AuftragStatus)}
	onablegen={(k, _von, nach) => void verschiebe(k, nach as AuftragStatus)}
	onverboten={verboten}
	gruppen={(sp) => UNTERGRUPPEN[sp as AuftragStatus]?.map((g) => ({ id: g.id, titel: g.titel, passt: (k: Karte) => untergruppe(k) === g.id })) ?? null}
	karte={kachel}
	{geist}
	{fuss}
	{meldung}
	{fehler}
	leer="Keine Aufträge"
	reiterLabel="Status wählen"
/>

<style>
	.ab-inhalt.laeuft {
		opacity: 0.7;
	}
	.ab-zeile {
		display: flex;
		flex-wrap: wrap;
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
		color: var(--ui-akzent-text);
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
		color: var(--ui-akzent-auf);
		font-size: 0.5625rem;
		font-weight: 600;
	}

	.ab-mehr {
		margin: 0.5rem 0.25rem 0;
		font-size: 0.75rem;
		color: var(--m365-text-leise);
	}
	.ab-mehr a {
		color: var(--ui-akzent-text);
	}
</style>
