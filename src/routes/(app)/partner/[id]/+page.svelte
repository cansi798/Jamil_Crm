<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import PartnerFormular from '$lib/components/PartnerFormular.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import { NACHWEIS_ART_NAMEN, NACHWEIS_ARTEN, PARTNER_ART_NAMEN } from '$lib/partner';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	/** Partner (Jamil msg 2856): Stammdaten/Konditionen, Ansprechpartner, Nachweise mit Ablauf, Aufträge, Auswertung. */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const p = $derived(data.partner);
	const a = $derived(data.auswertung);
	const fehlerIn = (b: string) => (form && 'bereich' in form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const okIn = (b: string) => (form && 'bereich' in form && form.bereich === b && 'ok' in form ? (form.ok as string) : null);
	const STATUS = { ok: 'gültig', bald: 'läuft bald ab', abgelaufen: 'abgelaufen', ohne: 'ohne Ablaufdatum' } as const;
	let bearbeiteKontakt = $state<string | null>(null);
	/** Jamil msg 3043: „Partner löschen“ oben rechts, Rückfrage unter dem Kopf. */
	let loeschenOffen = $state(false);
	$effect(() => {
		if (okIn('loeschen')) loeschenOffen = false;
	});
	const sofort = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head><title>{p.name} – Partner</title></svelte:head>

<main class="kd-seite pt-seite">
	<a href="/partner" class="kd-zurueck">← Partner</a>
	<header class="seiten-kopf">
		<div>
			<h1>{p.name}</h1>
			<p class="seiten-meta">{PARTNER_ART_NAMEN[p.art]}{p.aktiv ? '' : ' · inaktiv'}{p.ort ? ` · ${p.ort}` : ''}</p>
		</div>
		<div class="seiten-aktionen">
			{#if p.portalUrl}<a class="kd-knopf hell" href={p.portalUrl} target="_blank" rel="noopener noreferrer external">Partner-Portal öffnen ↗</a>{/if}
			<LoeschenKnopf ding="Partner" bind:offen={loeschenOffen} />
		</div>
	</header>
	<LoeschenPanel ding="Partner" bind:offen={loeschenOffen} fehler={fehlerIn('loeschen')}>
		Der Partner „{p.name}“ wird endgültig gelöscht. Hängt er an Aufträgen, wird er nur deaktiviert.
	</LoeschenPanel>
	{#if okIn('loeschen')}<p class="kd-info" role="status">{okIn('loeschen')}</p>{/if}
	{#if p.portalNotiz}<p class="kd-info">Portal: {p.portalNotiz}</p>{/if}

	<Abschnitt titel="Auswertung">
		<dl class="pt-zahlen">
			<div><dt>Aufträge als Auftraggeber</dt><dd>{a.auftraegeAlsAuftraggeber}</dd></div>
			<div><dt>Aufträge als Subunternehmer</dt><dd>{a.auftraegeAlsSubunternehmer}</dd></div>
			{#if a.umsatzCent != null}
				<div><dt>Umsatz (angenommene Angebote, netto)</dt><dd>{euro(a.umsatzCent)}</dd></div>
				<div><dt>Provision{p.provisionProzent !== null ? ` (${String(p.provisionProzent).replace('.', ',')} %)` : ''}</dt><dd>{a.provisionCent === null ? '– (keine Provision eingetragen)' : euro(a.provisionCent)}</dd></div>
				<div><dt>Fremdleistungen gesamt</dt><dd>{euro(a.fremdleistungCent ?? 0)}</dd></div>
			{/if}
		</dl>
	</Abschnitt>

	<Abschnitt titel="Nachweise" anzahl={p.nachweise.length}>
		{#if fehlerIn('nachweis')}<p class="kd-fehler" role="alert">{fehlerIn('nachweis')}</p>{/if}
		{#if okIn('nachweis')}<p class="kd-info" role="status">{okIn('nachweis')}</p>{/if}
		<ul class="kd-liste">
			{#each p.nachweise as n (n.id)}
				<li class="pt-zeile">
					<span>
						<strong>{NACHWEIS_ART_NAMEN[n.art]}</strong>{n.bezeichnung ? ` – ${n.bezeichnung}` : ''}
						<span class={`pt-status s-${n.status}`}>{n.gueltigBis ? `gültig bis ${tagDeutsch(n.gueltigBis)} · ` : ''}{STATUS[n.status]}</span>
					</span>
					<span class="pt-aktionen">
						{#if n.dateiName}<a href={`/partner/${p.id}/nachweis/${n.id}`} target="_blank" rel="noopener">{n.dateiName}</a>{/if}
						<form method="POST" action="?/nachweisLoeschen" use:enhance={sofort}>
							<input type="hidden" name="nachweisId" value={n.id} />
							<button type="submit" class="knopf-subtil klein" onclick={(e) => { if (!confirm('Nachweis löschen?')) e.preventDefault(); }}>Löschen</button>
						</form>
					</span>
				</li>
			{:else}
				<li class="kd-leer">Noch keine Nachweise.</li>
			{/each}
		</ul>
		<AddPanel label="Nachweis hinzufügen" offen={!!fehlerIn('nachweis')}>
			{#snippet children(schliessen)}
				<form method="POST" action="?/nachweis" enctype="multipart/form-data" use:enhance class="kd-formular">
					<label>Art
						<Auswahl name="art" required>{#each NACHWEIS_ARTEN as x (x)}<option value={x}>{NACHWEIS_ART_NAMEN[x]}</option>{/each}</Auswahl>
					</label>
					<label>Bezeichnung (optional) <input name="bezeichnung" maxlength="200" placeholder="z. B. Police 12345" /></label>
					<label>Gültig bis <input name="gueltigBis" type="date" /></label>
					<label>Datei (PDF, JPEG oder PNG, bis 10 MB) <input name="datei" type="file" accept="application/pdf,image/jpeg,image/png" /></label>
					<p class="kd-info">30 Tage vor Ablauf entsteht eine Aufgabe mit Erinnerung für alle, die Partner verwalten.</p>
					<div class="af-fuss">
						<button type="submit" class="kd-knopf">Nachweis speichern</button>
						<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					</div>
				</form>
			{/snippet}
		</AddPanel>
	</Abschnitt>

	<Abschnitt titel="Ansprechpartner" anzahl={p.kontakte.length}>
		{#if fehlerIn('kontakt')}<p class="kd-fehler" role="alert">{fehlerIn('kontakt')}</p>{/if}
		<ul class="kd-liste">
			{#each p.kontakte as c (c.id)}
				<li class="pt-zeile">
					{#if bearbeiteKontakt === c.id}
						<form method="POST" action="?/kontakt" use:enhance={() => async ({ update }) => { await update({ reset: false }); bearbeiteKontakt = null; }} class="kd-formular pt-kontakt">
							<input type="hidden" name="kontaktId" value={c.id} />
							<input name="name" required maxlength="200" value={c.name} aria-label="Name" />
							<input name="rolle" maxlength="100" value={c.rolle ?? ''} placeholder="Rolle" aria-label="Rolle" />
							<input name="telefon" maxlength="50" value={c.telefon ?? ''} placeholder="Telefon" aria-label="Telefon" />
							<input name="email" maxlength="200" value={c.email ?? ''} placeholder="E-Mail" aria-label="E-Mail" />
							<button type="submit" class="kd-knopf klein">Speichern</button>
						</form>
					{:else}
						<span>
							<strong>{c.name}</strong>{c.rolle ? ` · ${c.rolle}` : ''}
							<span class="kd-info">
								{#if c.telefon}<a href={`tel:${c.telefon.replace(/[^0-9+]/g, '')}`}>{c.telefon}</a>{/if}
								{#if c.email}{c.telefon ? ' · ' : ''}<a href={`mailto:${c.email}`}>{c.email}</a>{/if}
							</span>
						</span>
						<span class="pt-aktionen">
							<button type="button" class="knopf-subtil klein" onclick={() => (bearbeiteKontakt = c.id)}>Bearbeiten</button>
							<form method="POST" action="?/kontaktLoeschen" use:enhance={sofort}>
								<input type="hidden" name="kontaktId" value={c.id} />
								<button type="submit" class="knopf-subtil klein">Entfernen</button>
							</form>
						</span>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">Noch keine Ansprechpartner.</li>
			{/each}
		</ul>
		<AddPanel label="Ansprechpartner hinzufügen">
			{#snippet children(schliessen)}
				<form method="POST" action="?/kontakt" use:enhance class="kd-formular">
					<label>Name <input name="name" required maxlength="200" /></label>
					<label>Rolle <input name="rolle" maxlength="100" placeholder="z. B. Bauleiter, Disposition" /></label>
					<label>Telefon <input name="telefon" type="tel" maxlength="50" /></label>
					<label>E-Mail <input name="email" type="email" maxlength="200" /></label>
					<div class="af-fuss">
						<button type="submit" class="kd-knopf">Speichern</button>
						<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					</div>
				</form>
			{/snippet}
		</AddPanel>
	</Abschnitt>

	<Abschnitt titel="Aufträge" anzahl={data.auftraege.length}>
		<ul class="kd-liste">
			{#each data.auftraege as x (x.id)}
				<li><a href={`/auftraege/${x.id}`}><strong>{x.nummer} {x.titel}</strong><span class="kd-info">{x.rolle}</span></a></li>
			{:else}
				<li class="kd-leer">Noch keine Aufträge mit diesem Partner.</li>
			{/each}
		</ul>
	</Abschnitt>

	<Abschnitt titel="Stammdaten und Konditionen">
		{#if okIn('stamm')}<p class="kd-info" role="status">{okIn('stamm')}</p>{/if}
		<PartnerFormular action="?/speichern" knopf="Speichern" werte={form && 'werte' in form && form.bereich === 'stamm' ? (form.werte as Record<string, string>) : p} fehler={fehlerIn('stamm')} mitAktiv />
	</Abschnitt>
</main>

<style>
	.pt-zahlen {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		margin: 0;
	}
	.pt-zahlen dt {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.pt-zahlen dd {
		margin: 0;
		font-size: var(--ui-schrift-l);
		font-weight: 700;
	}
	.pt-zeile {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		min-width: 0;
	}
	.pt-zeile > span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.pt-aktionen {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.pt-aktionen form {
		margin: 0;
	}
	.pt-status {
		display: block;
		font-size: var(--ui-schrift-s);
	}
	.pt-status.s-abgelaufen {
		color: var(--ui-gefahr);
		font-weight: 700;
	}
	.pt-status.s-bald {
		color: var(--ui-orange);
		font-weight: 600;
	}
	.pt-kontakt {
		display: grid;
		gap: 0.4rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
		width: 100%;
	}
</style>
