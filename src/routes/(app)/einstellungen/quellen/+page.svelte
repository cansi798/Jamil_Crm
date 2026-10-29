<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { rueckfrage } from '$lib/rueckfrage';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import AuftragsquelleEtikett from '$lib/components/AuftragsquelleEtikett.svelte';
	import { standardFarbe } from '$lib/farben';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import { ABLAUF_SCHRITTE } from '$lib/auftrag-board';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { partnerHinweis } from '$lib/partner';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });

	// Ablauf je Auftragsquelle (Jamil msg 3703): eine Quelle wählen, je Schritt „gilt / überspringen“
	let ablaufQuelle = $state<string>('');
	const gewaehlt = $derived(data.quellen.find((q) => q.id === ablaufQuelle) ?? data.quellen[0] ?? null);
	const ABLAUF_OPTIONEN = [
		{ wert: 'gilt', text: 'gilt' },
		{ wert: 'ueberspringen', text: 'überspringen' }
	] as const;
	const anzahlUebersprungen = (q: { uebersprungen: string[] }) => q.uebersprungen.length;
	const ablaufMeldung = $derived(form && form.bereich === 'ablauf' && 'ergebnis' in form ? 'Ablauf gespeichert.' : null);
</script>

<svelte:head>
	<title>Auftragsquellen</title>
</svelte:head>

<main class="kd-seite">
	<h1>Auftragsquellen</h1>
	<p class="kd-info">
		Woher kommen eure Aufträge? Bei jedem neuen Auftrag wird die Auftragsquelle gewählt; die <a href="/auswertung/quellen">Auswertung</a> zeigt, was
		jede Auftragsquelle bringt. Die Farbe erscheint als Etikett auf den Auftragskarten und in der Liste. Eine Auftragsquelle, die schon an
		Aufträgen hängt, wird beim Löschen nur ausgeschaltet. Jeder Auftraggeber-Partner erscheint hier automatisch als eigene Quelle (zuerst
		ausgeschaltet); solche Partner-Quellen lassen sich nur aus- und einschalten, nicht löschen.
	<InfoFenster id="quellen.seite" /></p>
	{#if form && 'ergebnis' in form && form.ergebnis === 'deaktiviert'}
		<p class="kt-hinweis" role="status">Die Auftragsquelle hängt an Aufträgen und wurde deshalb nur ausgeschaltet.</p>
	{/if}

	<ol class="qu-liste" aria-label="Auftragsquellen">
		{#each data.quellen as q, i (q.id)}
			<li class:aus={!q.aktiv}>
				<form method="POST" action="?/speichern" use:enhance={ohneReset} class="qu-zeile">
					<input type="hidden" name="id" value={q.id} />
					<input type="color" name="farbe" value={q.farbe} class="qu-farbe" aria-label={`Farbe ${q.name}`} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
					<input type="text" name="name" value={q.name} maxlength="100" required aria-label={`Name ${q.name}`} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
					<AuftragsquelleEtikett name={q.name} farbe={q.farbe} />
					<label class="kd-haken">
						<input type="checkbox" name="aktiv" value="true" checked={q.aktiv} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
						<span>aktiv</span>
					</label>
					<input type="hidden" name="aktiv" value="false" />
					<span class="kd-info">{q.auftraege} Auftr.</span>
					{#if anzahlUebersprungen(q) > 0}<span class="ah-chip leise" data-testid="quelle-uebersprungen">{anzahlUebersprungen(q)} {anzahlUebersprungen(q) === 1 ? 'Schritt' : 'Schritte'} übersprungen</span>{/if}
				</form>
				<div class="qu-knoepfe">
					{#if q.partnerName}
						<!-- Partner-Quelle (Jamil msg 3707): gehört fest zum Partner, kein Löschen -->
						<span class="ah-chip" data-testid="quelle-partner" title={partnerHinweis(q.partnerName)}>Partner</span>
					{:else if data.auftraggeber.length}
						<form method="POST" action="?/partner" use:enhance={ohneReset}>
							<input type="hidden" name="id" value={q.id} />
							<Auswahl name="partnerId" klein aria-label={`Auftraggeber für ${q.name}`} onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
								<option value="" selected={!data.zuordnung[q.id]}>Auftraggeber: –</option>
								{#each data.auftraggeber as p (p.id)}<option value={p.id} selected={data.zuordnung[q.id] === p.id}>→ {p.name}</option>{/each}
							</Auswahl>
						</form>
					{/if}
					<form method="POST" action="?/verschieben" use:enhance>
						<input type="hidden" name="id" value={q.id} />
						<button type="submit" name="richtung" value="hoch" class="kd-knopf hell klein" disabled={i === 0} aria-label={`${q.name} nach oben`}>↑</button>
						<button type="submit" name="richtung" value="runter" class="kd-knopf hell klein" disabled={i === data.quellen.length - 1} aria-label={`${q.name} nach unten`}>↓</button>
					</form>
					{#if q.partnerName}
						<button type="button" class="kd-knopf hell klein" disabled aria-label={`${q.name} löschen – nicht möglich: ${partnerHinweis(q.partnerName)}`} title={partnerHinweis(q.partnerName)}>✕</button>
					{:else}
						<form method="POST" action="?/loeschen" use:enhance>
							<input type="hidden" name="id" value={q.id} />
							<button type="submit" class="kd-knopf hell klein" aria-label={`${q.name} löschen`} use:rueckfrage={`Auftragsquelle „${q.name}“ wirklich löschen?`}>✕</button>
						</form>
					{/if}
				</div>
				{#if q.partnerName}<p class="kd-info qu-partner-hinweis" data-testid="quelle-partner-hinweis">{partnerHinweis(q.partnerName)}</p>{/if}
				{#if fehlerIn(q.id)}<p role="alert" class="kd-fehler">{fehlerIn(q.id)}</p>{/if}
			</li>
		{/each}
	</ol>

	<AddPanel label="Auftragsquelle hinzufügen" offen={!!fehlerIn('neu')}>
		{#snippet children(schliessen)}
			<form method="POST" action="?/speichern" use:enhance class="kd-formular">
				{#if fehlerIn('neu')}<p role="alert" class="kd-fehler">{fehlerIn('neu')}</p>{/if}
				<label>Name <input type="text" name="name" maxlength="100" required placeholder="z. B. Instagram" /></label>
				<label class="qu-farbwahl">Farbe <input type="color" name="farbe" value={standardFarbe('', data.quellen.length)} class="qu-farbe" /></label>
				<div class="qu-knoepfe">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					<button type="submit" class="kd-knopf">Hinzufügen</button>
				</div>
			</form>
		{/snippet}
	</AddPanel>

	{#if gewaehlt}
		<Abschnitt titel="Ablauf je Auftragsquelle" id="ablauf" info="quellen.ablauf">
			{#snippet aktionen()}<button type="submit" form="ablauf-form" class="kd-knopf klein" data-testid="ablauf-speichern">Speichern</button>{/snippet}
			{#if fehlerIn('ablauf')}<p role="alert" class="kd-fehler">{fehlerIn('ablauf')}</p>{/if}
			{#if ablaufMeldung}<p role="status" class="kd-info qu-meldung">{ablaufMeldung}</p>{/if}
			<p class="kd-info">
				Je Auftragsquelle: Welche Schritte durchlaufen ihre Aufträge? „Überspringen“ blendet den Schritt im Board und in der Liste für diese
				Aufträge aus; ist ein ganzer Status übersprungen, geht „Weiter“ gleich zum nächsten geltenden Status. Standard: alles gilt (wie bisher).
			</p>
			<label class="qu-wahl">
				Auftragsquelle
				<Auswahl aria-label="Auftragsquelle für den Ablauf" onchange={(ev) => (ablaufQuelle = ev.currentTarget.value)}>
					{#each data.quellen as q (q.id)}<option value={q.id} selected={q.id === gewaehlt.id}>{q.name}{q.aktiv ? '' : ' (aus)'}</option>{/each}
				</Auswahl>
				<AuftragsquelleEtikett name={gewaehlt.name} farbe={gewaehlt.farbe} />
			</label>
			{#key gewaehlt.id}
				<form id="ablauf-form" method="POST" action="?/ablauf" use:enhance={ohneReset} data-testid="ablauf-form">
					<input type="hidden" name="id" value={gewaehlt.id} />
					<table class="qu-ablauf">
						<thead>
							<tr><th scope="col">Status</th><th scope="col">Schritt</th><th scope="col">Für {gewaehlt.name}</th></tr>
						</thead>
						<tbody>
							{#each ABLAUF_SCHRITTE as sch, i (sch.id)}
								<tr data-schritt={sch.id}>
									<td class="qu-status">{i === 0 || ABLAUF_SCHRITTE[i - 1].status !== sch.status ? STATUS_NAMEN[sch.status] : ''}</td>
									<th scope="row" class="qu-schritt">{sch.titel}</th>
									<td>
										<Segmente
											name={`schritt_${sch.id}`}
											label={`${sch.titel} für ${gewaehlt.name}`}
											optionen={ABLAUF_OPTIONEN}
											wert={gewaehlt.uebersprungen.includes(sch.id) ? 'ueberspringen' : 'gilt'}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</form>
			{/key}
		</Abschnitt>
	{/if}
</main>

<style>
	.qu-liste {
		list-style: none;
		margin: 1rem 0;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
	}
	.qu-liste li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
	}
	.qu-liste li + li {
		border-top: 1px solid var(--m365-rand);
	}
	.qu-liste li.aus input[type='text'] {
		color: var(--m365-text-leise);
	}
	.qu-zeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		flex: 1 1 18rem;
	}
	.qu-zeile input[type='text'] {
		width: auto !important;
		flex: 1 1 10rem;
	}
	.qu-farbe {
		width: 2.75rem !important;
		min-width: 2.75rem;
		height: 2.25rem;
		padding: 0.1rem !important;
		cursor: pointer;
	}
	.qu-farbwahl {
		display: flex !important;
		align-items: center;
		gap: 0.5rem;
	}
	.qu-partner-hinweis {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--ui-schrift-s);
	}
	/* Ablauf je Auftragsquelle (msg 3703) */
	.qu-wahl {
		display: flex !important;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin: 0.25rem 0 0.75rem;
	}
	.qu-wahl :global(select) {
		width: auto;
		min-width: 12rem;
	}
	.qu-meldung {
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.qu-ablauf {
		width: 100%;
		border-collapse: collapse;
	}
	.qu-ablauf th[scope='col'] {
		padding: 0.35rem 0.5rem;
		color: var(--m365-text-leise);
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		letter-spacing: 0.06em;
		text-align: left;
		text-transform: uppercase;
	}
	.qu-ablauf td,
	.qu-ablauf th[scope='row'] {
		padding: 0.45rem 0.5rem;
		border-top: 1px dashed var(--m365-rand);
		text-align: left;
		vertical-align: middle;
	}
	.qu-status {
		font-weight: 600;
		white-space: nowrap;
	}
	.qu-schritt {
		font-weight: 500;
	}
	@media (max-width: 40rem) {
		.qu-ablauf thead {
			display: none;
		}
		.qu-ablauf,
		.qu-ablauf tbody,
		.qu-ablauf tr,
		.qu-ablauf td,
		.qu-ablauf th[scope='row'] {
			display: block;
		}
		.qu-ablauf tr {
			padding: 0.5rem 0;
			border-top: 1px dashed var(--m365-rand);
		}
		.qu-ablauf td,
		.qu-ablauf th[scope='row'] {
			padding: 0.15rem 0;
			border: 0;
		}
		.qu-status:empty {
			display: none !important;
		}
	}
	.qu-knoepfe,
		.qu-knoepfe form {
		display: flex;
		gap: 0.35rem;
	}
</style>
