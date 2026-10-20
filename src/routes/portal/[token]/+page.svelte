<script lang="ts">
	import { enhance } from '$app/forms';
	import Rahmen from '$lib/components/buchung/Rahmen.svelte';
	import { euro } from '$lib/geld';
	import { tagDeutsch, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.seite);
	const doc = (art: string, id: string) => `/portal/${data.token}/dokument/${art}/${id}`;
	// Ablauf der Annahme: Knopf → Bestätigungsschritt (Name + AGB) → verbindlich annehmen
	let schritt = $state<{ id: string; art: 'annehmen' | 'ablehnen' } | null>(null);
	let sendet = $state(false);
	const STATUS_STUFEN = ['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet'];
	const STATUS_KUNDE: Record<string, string> = {
		anfrage: 'Anfrage eingegangen',
		angebot: 'Angebot erstellt',
		beauftragt: 'Beauftragt – wir planen',
		in_arbeit: 'In Arbeit',
		abgenommen: 'Fertig und abgenommen',
		abgerechnet: 'Abgeschlossen'
	};
</script>

<svelte:head>
	<title>{s.betrieb.name} – Ihr Auftrag</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<Rahmen betrieb={s.betrieb} farben={data.farben} logoUrl={s.betrieb.hatLogo ? `/portal/${data.token}/logo` : null}>
	<main class="po">
		{#each s.auftraege as a (a.id)}
			<section class="po-karte" aria-labelledby={`t-${a.id}`}>
				<p class="po-nummer">{a.nummer}</p>
				<h1 id={`t-${a.id}`}>{a.titel}</h1>
				{#if a.status}
					<p class="po-status" data-testid="portal-status">{STATUS_KUNDE[a.status.schluessel] ?? a.status.name}</p>
					<ol class="po-stufen" aria-label="Fortschritt">
						{#each STATUS_STUFEN as st, i (st)}
							<li class:erreicht={i <= STATUS_STUFEN.indexOf(a.status.schluessel)} aria-current={st === a.status.schluessel ? 'step' : undefined}><span class="unsichtbar">{STATUS_KUNDE[st]}</span></li>
						{/each}
					</ol>
				{/if}

				{#if a.termine}
					<h2>Nächste Termine</h2>
					{#if a.termine.length === 0}
						<p class="po-leise">Es ist gerade kein Termin geplant. Wir melden uns bei Ihnen.</p>
					{:else}
						<ul class="po-liste">
							{#each a.termine as t, i (i)}
								<li><strong>{tagKurz(t.tag)}</strong> zwischen {t.von} und {t.bis} Uhr · {t.art}{t.mitarbeiter.length ? ` · ${t.mitarbeiter.join(', ')}` : ''}</li>
							{/each}
						</ul>
					{/if}
				{/if}

				{#if a.angebote.length > 0}
					<h2>Angebote</h2>
					<ul class="po-liste">
						{#each a.angebote as an (an.id)}
							<li class="po-angebot">
								<div class="po-zeile">
									<a href={doc('angebot', an.id)} target="_blank" rel="noopener">Angebot {an.nummer} (PDF)</a>
									<span>{euro(an.bruttoCent)} inkl. MwSt.</span>
								</div>
								{#if an.status === 'angenommen'}
									<p class="po-ok">✓ Angenommen{an.entscheidung ? ` von ${an.entscheidung.name} am ${tagDeutsch(an.entscheidung.zeit.slice(0, 10))}` : ''}. Vielen Dank!</p>
								{:else if an.status === 'abgelehnt'}
									<p class="po-leise">Abgelehnt.</p>
								{:else if an.annehmbar}
									<p class="po-leise">Gültig bis {tagDeutsch(an.gueltigBis)}</p>
									{#if form?.angebotId === an.id && form?.fehler}<p role="alert" class="po-fehler">{form.fehler}</p>{/if}
									{#if schritt?.id === an.id && schritt.art === 'annehmen'}
										<form method="POST" action="?/entscheiden" class="po-form" use:enhance={() => { sendet = true; return async ({ update }) => { await update(); sendet = false; schritt = null; }; }}>
											<input type="hidden" name="angebotId" value={an.id} /><input type="hidden" name="entscheidung" value="angenommen" />
											<p class="po-hinweis">Bitte bestätigen: Sie nehmen das Angebot {an.nummer} über {euro(an.bruttoCent)} verbindlich an.</p>
											<label>Ihr Name <input name="name" required minlength="2" maxlength="200" autocomplete="name" /></label>
											<label class="po-check"><input type="checkbox" name="agb" value="ja" required />
												<span>Ich habe die {#if s.agbUrl}<a href={s.agbUrl} target="_blank" rel="noopener noreferrer">AGB</a>{:else}AGB{/if} gelesen und akzeptiere sie.{#if s.widerrufUrl} Hinweise zum <a href={s.widerrufUrl} target="_blank" rel="noopener noreferrer">Widerrufsrecht</a>.{/if}</span></label>
											<div class="po-knoepfe">
												<button type="submit" class="po-knopf" disabled={sendet}>Verbindlich annehmen</button>
												<button type="button" class="po-knopf hell" onclick={() => (schritt = null)}>Zurück</button>
											</div>
										</form>
									{:else if schritt?.id === an.id && schritt.art === 'ablehnen'}
										<form method="POST" action="?/entscheiden" class="po-form" use:enhance={() => { sendet = true; return async ({ update }) => { await update(); sendet = false; schritt = null; }; }}>
											<input type="hidden" name="angebotId" value={an.id} /><input type="hidden" name="entscheidung" value="abgelehnt" />
											<label>Ihr Name <input name="name" required minlength="2" maxlength="200" autocomplete="name" /></label>
											<label>Grund (freiwillig) <textarea name="grund" maxlength="1000" rows="3"></textarea></label>
											<div class="po-knoepfe">
												<button type="submit" class="po-knopf hell" disabled={sendet}>Angebot ablehnen</button>
												<button type="button" class="po-knopf hell" onclick={() => (schritt = null)}>Zurück</button>
											</div>
										</form>
									{:else}
										<div class="po-knoepfe">
											<button type="button" class="po-knopf" onclick={() => (schritt = { id: an.id, art: 'annehmen' })}>Angebot annehmen</button>
											<button type="button" class="po-knopf hell" onclick={() => (schritt = { id: an.id, art: 'ablehnen' })}>Ablehnen</button>
										</div>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if a.auftragsbestaetigungen.length > 0 || a.dateien.length > 0}
					<h2>Dokumente</h2>
					<ul class="po-liste">
						{#each a.auftragsbestaetigungen as ab (ab.id)}<li><a href={doc('ab', ab.id)} target="_blank" rel="noopener">Auftragsbestätigung {ab.nummer} (PDF)</a></li>{/each}
						{#each a.dateien as d (d.id)}<li><a href={doc('datei', d.id)} target="_blank" rel="noopener">{d.name}</a></li>{/each}
					</ul>
				{/if}
			</section>
		{:else}
			<section class="po-karte"><p>Hier ist gerade nichts freigegeben.</p></section>
		{/each}

		{#if form?.erledigt}
			<p role="status" class="po-ok">{form.erledigt === 'angenommen' ? 'Vielen Dank für Ihren Auftrag! Die Auftragsbestätigung finden Sie gleich hier unter „Dokumente“.' : 'Danke für Ihre Rückmeldung.'}</p>
		{/if}

		<section class="po-karte po-kontakt" aria-label="Kontakt">
			<h2>Fragen?</h2>
			<div class="po-knoepfe">
				{#if s.betrieb.telefon}<a class="po-knopf" href={`tel:${s.betrieb.telefon.replace(/[^0-9+]/g, '')}`}>Anrufen</a>{/if}
				{#if s.betrieb.email}<a class="po-knopf hell" href={`mailto:${s.betrieb.email}?subject=${encodeURIComponent(`Frage zu ${s.auftraege[0]?.nummer ?? 'meinem Auftrag'}`)}`}>E-Mail schreiben</a>{/if}
			</div>
		</section>
	</main>
</Rahmen>

<style>
	.po { display: grid; gap: var(--ui-a4); max-width: 44rem; margin: 0 auto; padding: var(--ui-a4); }
	.po-karte { background: var(--ui-flaeche); border-radius: var(--ui-radius-karte); box-shadow: var(--ui-schatten); padding: var(--ui-a4) var(--ui-a5); display: grid; gap: var(--ui-a2); }
	.po-nummer { margin: 0; font-size: var(--ui-schrift-s); color: var(--ui-text-leise); }
	h1 { margin: 0; font-size: var(--ui-schrift-xxl); }
	h2 { margin: var(--ui-a3) 0 0; font-size: var(--ui-schrift-l); }
	.po-status { margin: 0; font-weight: 600; color: var(--ui-akzent-text); }
	.po-stufen { display: flex; gap: 4px; list-style: none; margin: 0; padding: 0; }
	.po-stufen li { flex: 1; height: 6px; border-radius: 3px; background: var(--ui-rand); }
	.po-stufen li.erreicht { background: var(--ui-akzent); }
	.po-liste { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-a2); }
	.po-liste li { padding: var(--ui-a2) 0; border-bottom: 1px solid var(--ui-rand); }
	.po-angebot { display: grid; gap: var(--ui-a2); }
	.po-zeile { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--ui-a2); }
	.po-leise { margin: 0; color: var(--ui-text-leise); font-size: var(--ui-schrift-s); }
	.po-ok { margin: 0; color: var(--ui-gruen); font-weight: 600; }
	.po-fehler { margin: 0; color: var(--ui-gefahr); }
	.po-hinweis { margin: 0; font-weight: 600; }
	.po-form { display: grid; gap: var(--ui-a3); padding: var(--ui-a3); border-radius: var(--ui-radius); background: var(--ui-akzent-zart); border: 1px solid var(--ui-akzent-hell); }
	.po-form label { display: grid; gap: var(--ui-a1); font-size: var(--ui-schrift-m); }
	.po-form input:not([type='checkbox']), .po-form textarea { min-height: 2.75rem; font: inherit; padding: 0 var(--ui-a2); border: 1px solid var(--ui-rand-stark); border-radius: var(--ui-radius); }
	.po-form textarea { padding: var(--ui-a2); }
	.po-check { display: flex !important; gap: var(--ui-a2); align-items: flex-start; }
	.po-check input { width: 1.4rem; height: 1.4rem; margin-top: 2px; flex: none; }
	.po-knoepfe { display: flex; flex-wrap: wrap; gap: var(--ui-a2); }
	.po-knopf { display: inline-flex; align-items: center; justify-content: center; min-height: 3rem; padding: 0 var(--ui-a5); border: 0; border-radius: var(--ui-knopf-radius); background: var(--ui-akzent); color: var(--ui-akzent-auf); font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
	.po-knopf:hover { background: var(--ui-akzent-hover); }
	.po-knopf.hell { background: var(--ui-flaeche); color: var(--ui-akzent-text); border: 1px solid var(--ui-rand-stark); }
	.po-knopf:focus-visible { outline: none; box-shadow: var(--ui-fokus-ring); }
</style>
