<script lang="ts">
	import { mitEinstellungen } from '$lib/kennzahlen';
	import KennzahlKacheln, { type Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
		import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { terminKurz } from '$lib/einsatz-art';
	import { navigationsLink, telefonLink } from '$lib/kontakt-links';
	import AuftragBoard from '$lib/components/AuftragBoard.svelte';
	import AuftragHinweise from '$lib/components/AuftragHinweise.svelte';
	import { STATUS, STATUS_NAMEN } from '$lib/auftrag-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Link mit Ansicht, Status (nur Liste), „Meine“ und Suche (leere Werte entfallen). */
	const link = (o: { ansicht?: 'board' | 'liste'; status?: string | null; meine?: boolean; nachfassen?: boolean; zeitraum?: string } = {}) => {
		const ansicht = o.ansicht ?? data.ansicht;
		const status = o.status === undefined ? data.status : o.status;
		const meine = o.meine ?? data.meine;
		const p = new URLSearchParams();
		if (ansicht === 'liste') p.set('ansicht', 'liste');
		if (ansicht === 'liste' && status) p.set('status', status);
		if (data.suche) p.set('suche', data.suche);
		if (meine) p.set('meine', '1');
		if (data.quelle) p.set('quelle', data.quelle);
		if (o.nachfassen ?? data.nachfassenFaellig) p.set('nachfassen', 'faellig');
		const z = o.zeitraum ?? data.zeitraum;
		if (z !== 'monat') p.set('zeitraum', z);
		// Ausdrücklich „keine Filter“ (≠ erster Besuch): Marker, damit keine Standard-Ansicht darüber springt
		if (p.toString() === '') p.set('alle', '1');
		return `/auftraege?${p}`;
	};
	// Kennzahl-Kacheln (msg 2801): Status-Kachel öffnet die Liste mit diesem Status, nochmal klicken hebt ihn auf
	/** Kacheln: ganze Euro (netto), damit die Werte in die Kachel passen */
	const euroGanz = (cent: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(cent / 100));
	const STATUS_TON = { anfrage: 'grau', angebot: 'lila', beauftragt: 'blau', in_arbeit: 'orange', abgenommen: 'gruen', abgerechnet: 'grau' } as const;
	const aktiveKachel = $derived(data.nachfassenFaellig ? 'nachfassen' : data.ansicht === 'liste' && data.status ? data.status : null);
	const kacheln = $derived.by((): Kachel[] => {
		const kz = data.kennzahlen;
		if (!kz) return [];
		// Finanzpotenzial (msg 3047): mit Preisen der Wert als große Zahl, die Anzahl klein darunter; ohne Preise nur Anzahlen
		const wert = kz.wertJeStatusCent;
		const anzahl = (n: number) => `${n} ${n === 1 ? 'Auftrag' : 'Aufträge'}`;
		const l: Kachel[] = STATUS.map((st) => ({
			id: st,
			titel: STATUS_NAMEN[st],
			wert: wert ? (wert[st] === null ? '–' : euroGanz(wert[st]!)) : String(kz.jeStatus[st]),
			info: wert ? `${anzahl(kz.jeStatus[st])} · neu im Zeitraum` : 'neu im Zeitraum',
			href: aktiveKachel === st ? link({ ansicht: 'liste', status: null }) : link({ ansicht: 'liste', status: st, nachfassen: false }),
			ton: STATUS_TON[st]
		}));
		const nfWert = kz.nachfassenWertCent;
		l.push({ id: 'nachfassen', titel: 'Nachfassen fällig', wert: nfWert != null ? euroGanz(nfWert) : String(kz.nachfassenFaellig), info: nfWert != null ? `${anzahl(kz.nachfassenFaellig)} · jetzt` : 'jetzt', href: link({ nachfassen: !data.nachfassenFaellig }), ton: 'rot' });
		if (kz.wertOffenCent != null) l.push({ id: 'wert', titel: 'Auftragswert offen', wert: euroGanz(kz.wertOffenCent), info: 'angenommen, nicht abgerechnet', ton: 'gruen' });
		// Einstellungen je Kennzahl (Jamil msg 2946)
		return mitEinstellungen(l, kz, (id) => (id === 'nachfassen' ? 'auftraege_nachfassen' : id === 'wert' ? 'auftraege_wert' : 'auftraege_status'));
	});
	const BEZUG = { zustaendig: 'zuständig', todo: 'eigene Aufgabe', termin: 'eigener Termin' } as const;
</script>

<svelte:head>
	<title>Aufträge</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div><h1>{data.alle && !data.meine ? 'Aufträge' : 'Meine Aufträge'}</h1></div>
		{#if data.darfBearbeiten}
			<div class="seiten-aktionen"><a href="/auftraege/neu" class="kd-knopf">+ Auftrag</a></div>
		{/if}
	</header>

	<FilterLeiste ansichten="auftraege" label="Aufträge filtern">
		{#snippet suche()}
			{#if data.ansicht === 'liste'}<input type="hidden" name="ansicht" value="liste" />{/if}
			{#if data.ansicht === 'liste' && data.status}<input type="hidden" name="status" value={data.status} />{/if}
			{#if data.meine}<input type="hidden" name="meine" value="1" />{/if}
			{#if data.nachfassenFaellig}<input type="hidden" name="nachfassen" value="faellig" />{/if}
			<SuchFeld wert={data.suche} label="Aufträge suchen" placeholder="Nummer, Titel oder Kunde" />
		{/snippet}
		{#snippet filter()}
			{#if data.alle}
				<Umschalter
					label="Meine oder alle Aufträge"
					aktiv={data.meine ? 'meine' : 'alle'}
					eintraege={[
						{ wert: 'alle', text: 'Alle', href: link({ meine: false }) },
						{ wert: 'meine', text: 'Meine', href: link({ meine: true }) }
					]}
				/>
			{/if}
			{#if data.ansicht === 'liste'}
				<Umschalter
					label="Status"
					aktiv={data.status ?? 'alle'}
					eintraege={[{ wert: 'alle', text: 'Alle', href: link({ status: null }) }, ...STATUS.map((s) => ({ wert: s, text: STATUS_NAMEN[s], href: link({ status: s }) }))]}
				/>
			{/if}
			<Umschalter
				label="Weitere Filter"
				aktiv={data.nachfassenFaellig ? 'nachfassen' : null}
				eintraege={[{ wert: 'nachfassen', text: '↻ Nachfassen fällig', href: link({ nachfassen: !data.nachfassenFaellig }) }]}
			/>
			<div class="af-quelle-filter">
				<Auswahl name="quelle" klein aria-label="Auftragsquelle" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
					<option value="" selected={!data.quelle}>Alle Auftragsquellen</option>
					{#each data.quellen as q (q.id)}<option value={q.id} selected={data.quelle === q.id}>{q.name}{q.aktiv ? '' : ' (aus)'}</option>{/each}
					<option value="ohne" selected={data.quelle === 'ohne'}>Ohne Auftragsquelle</option>
				</Auswahl>
			</div>
		{/snippet}
		{#snippet rechts()}
			<Umschalter
				label="Ansicht"
				aktiv={data.ansicht}
				eintraege={[
					{ wert: 'board', text: 'Board', href: link({ ansicht: 'board' }) },
					{ wert: 'liste', text: 'Liste', href: link({ ansicht: 'liste' }) }
				]}
			/>
		{/snippet}
	</FilterLeiste>

	{#if kacheln.length > 0}
		<KennzahlKacheln label="Aufträge" {kacheln} zeitraum={data.zeitraum} zeitraumLink={(a) => link({ zeitraum: a })} aktiv={aktiveKachel} />
		{#if data.kennzahlen?.wertJeStatusCent}
			<details class="af-rechnung">
				<summary>So wird gerechnet</summary>
				<p class="kd-info">
					Beträge netto, ganze Euro. Je Status zählen die im Zeitraum neu angelegten Aufträge (Anzahl klein darunter):
					Anfrage = neuester Angebotsentwurf (ohne Entwurf „–“) · Angebot = versendete, offene Angebote · Beauftragt, In
					Arbeit, Abgenommen = angenommene Angebote (Wert der Auftragsbestätigung) · Abgerechnet = Auftragswert, bis die
					Rechnungen mit der Lexware-Anbindung kommen · Nachfassen fällig = offene Angebote der Aufträge, bei denen das
					Nachfassen fällig ist (aktueller Stand). Überarbeitete Angebotsfassungen zählen nur einmal.
				</p>
			</details>
		{/if}
	{/if}

	{#if data.ansicht === 'board' && data.board}
		{#if !data.darfBearbeiten}
			<p class="kd-info">Zum Verschieben der Kacheln fehlt das Recht „Aufträge bearbeiten“.</p>
		{/if}
		<AuftragBoard spalten={data.board.spalten} darfBearbeiten={data.darfBearbeiten} mitPreisen={data.mitPreisen} />
		{#if data.board.spalten.every((s) => s.anzahl === 0)}
			<p class="kd-leer">
				{data.nachfassenFaellig ? 'Kein Nachfassen fällig.' : data.suche || data.quelle ? 'Keine Aufträge gefunden.' : data.alle && !data.meine ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
			</p>
		{/if}
	{:else}
		<ul class="kd-liste">
			{#each data.auftraege as a (a.id)}
				<li>
					<a href={`/auftraege/${a.id}`}>
						<span class="af-kopfzeile">
							<strong>{a.titel}</strong>
							<span class={`af-status s-${a.status}`}>{STATUS_NAMEN[a.status]}</span>
						</span>
						<span class="kd-info">{a.nummer} · {a.kundeName}</span>
						<AuftragHinweise quelleName={a.quelleName} quelleFarbe={a.quelleFarbe} angebotInfo={a.angebotInfo} nachfassenInfo={a.nachfassenInfo} />
						{#if a.kommenderTermin}
							<span class="kd-info">Nächster Termin: {terminKurz(a.kommenderTermin)}</span>
						{/if}
						{#if a.zustaendige.length > 0}
							<span class="kd-info">Zuständig: {a.zustaendige.map((z) => z.name).join(', ')}</span>
						{/if}
						{#if a.meinBezug && a.meinBezug.length > 0}
							<span class="af-bezug">{#each a.meinBezug as b (b)}<span class="af-bezug-chip">{BEZUG[b]}</span>{/each}</span>
						{/if}
						{#if a.objektBezeichnung || a.adresse}
							<span class="kd-info">{a.objektBezeichnung ? `Objekt: ${a.objektBezeichnung}` : 'Kundenadresse'}{a.adresse ? ` · ${a.adresse}` : ''}</span>
						{/if}
					</a>
					{#if navigationsLink(a.adresse) || telefonLink(a.telefon)}
						<span class="af-liste-vorort">
							{#if navigationsLink(a.adresse)}<a href={navigationsLink(a.adresse)} target="_blank" rel="noopener">Navigieren</a>{/if}
							{#if telefonLink(a.telefon)}<a href={telefonLink(a.telefon)}>Anrufen</a>{/if}
						</span>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">
					{data.nachfassenFaellig ? 'Kein Nachfassen fällig.' : data.suche || data.status || data.quelle ? 'Keine Aufträge gefunden.' : data.alle && !data.meine ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
				</li>
			{/each}
		</ul>

		{#if data.auftraege.length >= data.maxTreffer}
			<p class="kd-info">Es werden höchstens {data.maxTreffer} Aufträge angezeigt. Bitte die Suche eingrenzen.</p>
		{/if}
	{/if}
</main>

<style>
	.af-rechnung {
		margin: -0.4rem 0 var(--ui-abstand-block);
	}
	.af-rechnung summary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		color: var(--ui-akzent-text);
		font-size: var(--ui-schrift-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.af-rechnung p {
		margin: 0;
		max-width: 60rem;
	}
	.af-suche {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}
	@media (max-width: 30rem) {
		.af-suche {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.af-suche .af-quelle-filter {
			grid-column: 1 / -1;
			max-width: none;
		}
	}
	.af-quelle-filter {
		width: auto !important;
		max-width: 12rem;
	}
	.af-meine {
		display: flex;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
	}
	.af-meine .pill {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		padding: 0 1rem;
		border: 1px solid var(--m365-rand);
		border-radius: 999px;
		text-decoration: none;
		color: inherit;
	}
	.af-meine .pill[aria-current='page'] {
		background: var(--m365-primaer);
		border-color: var(--m365-primaer);
		color: var(--ui-akzent-auf);
	}
	.af-liste-vorort {
		display: flex;
		gap: 1rem;
		padding: 0 1rem 0.75rem;
	}
	.af-liste-vorort a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		font-weight: 600;
	}
	.af-bezug {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.af-bezug-chip {
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		background: var(--m365-primaer-hell);
		color: var(--ui-akzent-text);
	}
</style>
