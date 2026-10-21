<script lang="ts">
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import FortschrittsWeg from '$lib/components/portal/FortschrittsWeg.svelte';
	import PortalSchritte from '$lib/components/portal/PortalSchritte.svelte';
	import { farbStil } from '$lib/farbe';
	import { euro } from '$lib/geld';
	import { tagDeutsch, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	/**
	 * Kundenportal im Handwerks-Design (Jamil msgs 2848, 2851): Kopf mit Logo und Hausfarbe, kleines Dashboard
	 * (offene Angebote, nächster Termin, Dokumente), je Auftrag der handgezeichnete Fortschrittsweg, Arbeitsschritte mit
	 * Lautstärke/Schmutz, Termine, Angebote (online annehmen), Dokumente – rechts Ansprechpartner und Team.
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.seite);
	const doc = (art: string, id: string) => `/portal/${data.token}/dokument/${art}/${id}`;
	const stil = $derived(`${farbStil(data.farben.akzent)}; --ui-akzent-dunkel: var(--ui-akzent-text)`);
	const webLink = $derived(s.betrieb.web ? (/^https?:\/\//i.test(s.betrieb.web) ? s.betrieb.web : `https://${s.betrieb.web}`) : null);
	const telLink = $derived(s.betrieb.telefon ? `tel:${s.betrieb.telefon.replace(/[^0-9+]/g, '')}` : null);
	const mailLink = (nummer: string) => (s.betrieb.email ? `mailto:${s.betrieb.email}?subject=${encodeURIComponent(`Frage zu ${nummer}`)}` : null);

	// Ablauf der Annahme: Knopf → Bestätigungsschritt (Name + AGB) → verbindlich annehmen
	let schritt = $state<{ id: string; art: 'annehmen' | 'ablehnen' } | null>(null);
	let sendet = $state(false);

	const STUFEN = [
		{ schluessel: 'anfrage', name: 'Anfrage' },
		{ schluessel: 'angebot', name: 'Angebot' },
		{ schluessel: 'beauftragt', name: 'Beauftragt' },
		{ schluessel: 'in_arbeit', name: 'In Arbeit' },
		{ schluessel: 'abgenommen', name: 'Fertig' },
		{ schluessel: 'abgerechnet', name: 'Abgeschlossen' }
	];
	const STATUS_KUNDE: Record<string, string> = {
		anfrage: 'Ihre Anfrage ist bei uns eingegangen',
		angebot: 'Ihr Angebot ist fertig',
		beauftragt: 'Beauftragt – wir planen die Arbeiten',
		in_arbeit: 'Wir sind bei der Arbeit',
		abgenommen: 'Fertig und abgenommen',
		abgerechnet: 'Abgeschlossen – vielen Dank!'
	};

	// Dashboard über alle Aufträge
	const offeneAngebote = $derived(s.auftraege.flatMap((a) => a.angebote.filter((x) => x.annehmbar)));
	const naechster = $derived(
		s.auftraege
			.flatMap((a) => (a.termine ?? []).map((t) => ({ ...t, auftrag: a.titel })))
			.sort((x, y) => (x.tag + x.von).localeCompare(y.tag + y.von))[0] ?? null
	);
	const dokumente = $derived(s.auftraege.reduce((n, a) => n + a.angebote.length + a.auftragsbestaetigungen.length + a.dateien.length, 0));
</script>

<svelte:head>
	<title>{s.betrieb.name} – Ihr Kundenportal</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="pt" style={stil}>
	<header class="pt-kopf">
		<div class="pt-kopf-innen">
			{#if s.betrieb.hatLogo}
				<span class="pt-logo"><img src={`/portal/${data.token}/logo`} alt={`Logo ${s.betrieb.name}`} /></span>
			{/if}
			<span class="pt-firma">
				<small>Ihr Kundenportal</small>
				<strong>{s.betrieb.name}</strong>
			</span>
			{#if telLink}<a class="pt-kopf-tel" href={telLink}>{s.betrieb.telefon}</a>{/if}
		</div>
	</header>

	<main class="pt-inhalt">
		<section class="pt-dash" aria-label="Überblick">
			<div class="pt-kachel">
				<span class="pt-k-titel">Nächster Termin</span>
				{#if naechster}
					<strong>{tagKurz(naechster.tag)}</strong>
					<span>{naechster.von}–{naechster.bis} Uhr · {naechster.art}</span>
				{:else}
					<strong>–</strong>
					<span>Gerade kein Termin geplant</span>
				{/if}
			</div>
			<a class="pt-kachel" class:hervor={offeneAngebote.length > 0} href={offeneAngebote.length ? '#angebote' : undefined}>
				<span class="pt-k-titel">Offene Angebote</span>
				<strong>{offeneAngebote.length}</strong>
				<span>{offeneAngebote.length ? `${euro(offeneAngebote.reduce((n, x) => n + x.bruttoCent, 0))} – online annehmen` : 'Nichts zu entscheiden'}</span>
			</a>
			<div class="pt-kachel">
				<span class="pt-k-titel">Dokumente</span>
				<strong>{dokumente}</strong>
				<span>Angebote, Bestätigungen, Unterlagen</span>
			</div>
		</section>

		{#if form?.erledigt}
			<p role="status" class="pt-meldung">{form.erledigt === 'angenommen' ? 'Vielen Dank für Ihren Auftrag! Die Auftragsbestätigung finden Sie gleich hier unter „Dokumente“.' : 'Danke für Ihre Rückmeldung.'}</p>
		{/if}

		{#each s.auftraege as a (a.id)}
			<section class="pt-auftrag" aria-labelledby={`t-${a.id}`}>
				<div class="pt-haupt">
					<div class="pt-karte pt-titelkarte">
						<p class="pt-nummer">Auftrag {a.nummer}</p>
						<h1 id={`t-${a.id}`}>{a.titel}</h1>
						{#if a.status}
							<p class="pt-status" data-testid="portal-status">{STATUS_KUNDE[a.status.schluessel] ?? a.status.name}</p>
							<FortschrittsWeg stufen={STUFEN} aktuell={a.status.schluessel} />
						{/if}
					</div>

					{#if a.schritte && a.schritte.length > 0}
						<div class="pt-karte">
							<h2>Arbeitsschritte</h2>
							<p class="pt-leise">Damit Sie planen können: wie laut und wie staubig es bei den einzelnen Schritten wird.</p>
							<PortalSchritte schritte={a.schritte} />
						</div>
					{/if}

					{#if a.termine}
						<div class="pt-karte">
							<h2>Nächste Termine</h2>
							{#if a.termine.length === 0}
								<p class="pt-leise">Es ist gerade kein Termin geplant. Wir melden uns bei Ihnen.</p>
							{:else}
								<ul class="pt-termine">
									{#each a.termine as t, i (i)}
										<li>
											<span class="pt-datum"><strong>{tagKurz(t.tag).split(' ')[1] ?? tagKurz(t.tag)}</strong><small>{tagKurz(t.tag).split(' ')[0]}</small></span>
											<span class="pt-termin-text"><strong>{t.von}–{t.bis} Uhr</strong> · {t.art}{#if t.mitarbeiter.length}<br /><small>{t.mitarbeiter.join(', ')}</small>{/if}</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}

					{#if a.angebote.length > 0}
						<div class="pt-karte" id="angebote">
							<h2>Angebote</h2>
							<ul class="pt-liste">
								{#each a.angebote as an (an.id)}
									<li class="pt-angebot">
										<div class="pt-zeile">
											<a class="pt-dok" href={doc('angebot', an.id)} target="_blank" rel="noopener"><span class="pt-pdf" aria-hidden="true">PDF</span>Angebot {an.nummer}</a>
											<strong>{euro(an.bruttoCent)} <small>inkl. MwSt.</small></strong>
										</div>
										{#if an.status === 'angenommen'}
											<p class="pt-ok">✓ Angenommen{an.entscheidung ? ` von ${an.entscheidung.name} am ${tagDeutsch(an.entscheidung.zeit.slice(0, 10))}` : ''}. Vielen Dank!</p>
										{:else if an.status === 'abgelehnt'}
											<p class="pt-leise">Abgelehnt.</p>
										{:else if an.annehmbar}
											<p class="pt-leise">Gültig bis {tagDeutsch(an.gueltigBis)}</p>
											{#if form?.angebotId === an.id && form?.fehler}<p role="alert" class="pt-fehler">{form.fehler}</p>{/if}
											{#if schritt?.id === an.id && schritt.art === 'annehmen'}
												<form method="POST" action="?/entscheiden" class="pt-form" use:enhance={() => { sendet = true; return async ({ update }) => { await update(); sendet = false; schritt = null; }; }}>
													<input type="hidden" name="angebotId" value={an.id} /><input type="hidden" name="entscheidung" value="angenommen" />
													<p class="pt-hinweis">Bitte bestätigen: Sie nehmen das Angebot {an.nummer} über {euro(an.bruttoCent)} verbindlich an.</p>
													<label>Ihr Name <input name="name" required minlength="2" maxlength="200" autocomplete="name" /></label>
													<label class="pt-check"><input type="checkbox" name="agb" value="ja" required />
														<span>Ich habe die {#if s.agbUrl}<a href={s.agbUrl} target="_blank" rel="noopener noreferrer">AGB</a>{:else}AGB{/if} gelesen und akzeptiere sie.{#if s.widerrufUrl} Hinweise zum <a href={s.widerrufUrl} target="_blank" rel="noopener noreferrer">Widerrufsrecht</a>.{/if}</span></label>
													<div class="pt-knoepfe">
														<button type="submit" class="pt-knopf" disabled={sendet}>Verbindlich annehmen</button>
														<button type="button" class="pt-knopf hell" onclick={() => (schritt = null)}>Zurück</button>
													</div>
												</form>
											{:else if schritt?.id === an.id && schritt.art === 'ablehnen'}
												<form method="POST" action="?/entscheiden" class="pt-form" use:enhance={() => { sendet = true; return async ({ update }) => { await update(); sendet = false; schritt = null; }; }}>
													<input type="hidden" name="angebotId" value={an.id} /><input type="hidden" name="entscheidung" value="abgelehnt" />
													<label>Ihr Name <input name="name" required minlength="2" maxlength="200" autocomplete="name" /></label>
													<label>Grund (freiwillig) <textarea name="grund" maxlength="1000" rows="3"></textarea></label>
													<div class="pt-knoepfe">
														<button type="submit" class="pt-knopf hell" disabled={sendet}>Angebot ablehnen</button>
														<button type="button" class="pt-knopf hell" onclick={() => (schritt = null)}>Zurück</button>
													</div>
												</form>
											{:else}
												<div class="pt-knoepfe">
													<button type="button" class="pt-knopf" onclick={() => (schritt = { id: an.id, art: 'annehmen' })}>Angebot annehmen</button>
													<button type="button" class="pt-knopf hell" onclick={() => (schritt = { id: an.id, art: 'ablehnen' })}>Ablehnen</button>
												</div>
											{/if}
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if a.auftragsbestaetigungen.length > 0 || a.dateien.length > 0 || a.links?.length}
						<div class="pt-karte">
							<h2>Dokumente</h2>
							<ul class="pt-doks">
								{#each a.auftragsbestaetigungen as ab (ab.id)}<li><a class="pt-dok" href={doc('ab', ab.id)} target="_blank" rel="noopener"><span class="pt-pdf" aria-hidden="true">PDF</span>Auftragsbestätigung {ab.nummer}</a></li>{/each}
								{#each a.dateien as d (d.id)}<li><a class="pt-dok" href={doc('datei', d.id)} target="_blank" rel="noopener"><span class="pt-pdf" aria-hidden="true">{d.typ.startsWith('image/') ? 'BILD' : d.typ === 'application/pdf' ? 'PDF' : 'DATEI'}</span>{d.name}</a></li>{/each}
								{#each a.links ?? [] as l (l.url)}<li><a class="pt-dok" href={l.url} target="_blank" rel="noopener noreferrer external"><span class="pt-pdf" aria-hidden="true">LINK</span>{l.titel}</a></li>{/each}
							</ul>
						</div>
					{/if}
				</div>

				<aside class="pt-seite" aria-label={`Kontakt zu ${a.titel}`}>
					<div class="pt-karte pt-ansprech">
						<h2>Ihr Ansprechpartner</h2>
						{#if a.ansprechpartner}
							<p class="pt-person"><Avatar name={a.ansprechpartner} groesse={44} /><span><strong>{a.ansprechpartner}</strong><small>{s.betrieb.name}</small></span></p>
						{:else}
							<p class="pt-person"><span><strong>{s.betrieb.name}</strong></span></p>
						{/if}
						<div class="pt-knoepfe">
							{#if telLink}<a class="pt-knopf" href={telLink}>Anrufen</a>{/if}
							{#if mailLink(a.nummer)}<a class="pt-knopf hell" href={mailLink(a.nummer)}>E-Mail schreiben</a>{/if}
						</div>
					</div>
					{#if a.team.length > 0}
						<div class="pt-karte">
							<h2>Ihr Team</h2>
							<ul class="pt-team">
								{#each a.team as name (name)}<li><Avatar {name} groesse={32} /><span>{name}</span></li>{/each}
							</ul>
						</div>
					{/if}
				</aside>
			</section>
		{:else}
			<section class="pt-karte"><p>Hier ist gerade nichts freigegeben.</p></section>
		{/each}
	</main>

	<footer class="pt-fuss">
		<span>{s.betrieb.name}</span>
		{#if s.betrieb.telefon}<a href={telLink}>{s.betrieb.telefon}</a>{/if}
		{#if s.betrieb.email}<a href={`mailto:${s.betrieb.email}`}>{s.betrieb.email}</a>{/if}
		{#if webLink}<a href={webLink} target="_blank" rel="noopener noreferrer">{s.betrieb.web}</a>{/if}
	</footer>
</div>

<style>
	:global(body) {
		background: var(--ui-hintergrund);
	}
	.pt {
		min-height: 100vh;
		color: var(--ui-text);
	}
	/* Kopf: Anthrazit wie die App, Akzentlinie in der Hausfarbe */
	.pt-kopf {
		background: var(--ui-nav);
		color: var(--ui-nav-text);
		border-bottom: 4px solid var(--ui-akzent);
	}
	.pt-kopf-innen,
	.pt-inhalt,
	.pt-fuss {
		max-width: 72rem;
		margin: 0 auto;
		padding-left: 16px;
		padding-right: 16px;
	}
	.pt-kopf-innen {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		min-height: 4.5rem;
	}
	.pt-logo {
		display: grid;
		place-items: center;
		height: 3rem;
		padding: 0.3rem 0.5rem;
		border-radius: 10px;
		background: #fff;
	}
	.pt-logo img {
		max-height: 2.4rem;
		max-width: 8rem;
		object-fit: contain;
	}
	.pt-firma {
		display: grid;
		min-width: 0;
	}
	.pt-firma small {
		color: var(--ui-akzent);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.pt-firma strong {
		color: #fff;
		font-family: var(--ui-schrift-titel);
		font-size: 1.05rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.pt-kopf-tel {
		margin-left: auto;
		color: var(--ui-nav-text);
		font-weight: 600;
		white-space: nowrap;
	}
	@media (max-width: 640px) {
		.pt-kopf-tel {
			display: none;
		}
	}
	.pt-inhalt {
		display: grid;
		gap: 1rem;
		padding-top: 1.25rem;
		padding-bottom: 2rem;
	}
	/* Dashboard */
	.pt-dash {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}
	@media (max-width: 760px) {
		/* Handy: drei flache Zeilen – Titel links, Wert rechts, Hinweis darunter */
		.pt-dash {
			grid-template-columns: 1fr;
			gap: 0.5rem;
		}
		.pt-kachel {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 0 0.75rem;
			padding: 0.6rem 0.85rem;
		}
		.pt-kachel strong {
			grid-row: 1 / span 2;
			grid-column: 2;
			font-size: 1.2rem;
			text-align: right;
		}
		.pt-kachel span:last-child {
			font-size: var(--ui-schrift-xs);
		}
	}
	.pt-kachel {
		display: grid;
		gap: 0.15rem;
		padding: 0.9rem 1.1rem;
		border-radius: var(--ui-radius-karte);
		border: 1px solid var(--ui-rand);
		border-left: 4px solid var(--ui-akzent);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
		color: var(--ui-text);
		text-decoration: none;
		animation: pt-rein 0.45s ease-out both;
	}
	.pt-kachel:nth-child(2) {
		animation-delay: 0.08s;
	}
	.pt-kachel:nth-child(3) {
		animation-delay: 0.16s;
	}
	a.pt-kachel[href]:hover {
		background: var(--ui-akzent-zart);
	}
	.pt-kachel.hervor {
		background: var(--ui-akzent-hell);
	}
	.pt-k-titel {
		color: var(--ui-text-leise);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.pt-kachel strong {
		font-family: var(--ui-schrift-titel);
		font-size: 1.5rem;
		line-height: 1.2;
	}
	.pt-kachel span:last-child {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	/* Auftrag: Hauptspalte + Kontakt rechts */
	.pt-auftrag {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		gap: 1rem;
		align-items: start;
	}
	@media (max-width: 900px) {
		.pt-auftrag {
			grid-template-columns: 1fr;
		}
	}
	.pt-haupt,
	.pt-seite {
		display: grid;
		gap: 1rem;
	}
	.pt-seite {
		position: sticky;
		top: 1rem;
	}
	@media (max-width: 900px) {
		.pt-seite {
			position: static;
		}
	}
	.pt-karte {
		display: grid;
		gap: 0.6rem;
		padding: 1.1rem 1.25rem;
		border-radius: var(--ui-radius-karte);
		border: 1px solid var(--ui-rand);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
		animation: pt-rein 0.5s ease-out both;
	}
	.pt-titelkarte {
		gap: 0.4rem;
	}
	.pt-nummer {
		margin: 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	h1 {
		margin: 0;
		font-family: var(--ui-schrift-titel);
		font-size: clamp(1.4rem, 3vw, 1.9rem);
		line-height: 1.2;
	}
	h2 {
		margin: 0;
		font-family: var(--ui-schrift-titel);
		font-size: 1.05rem;
	}
	.pt-status {
		margin: 0 0 0.25rem;
		color: var(--ui-akzent-text);
		font-weight: 700;
	}
	.pt-leise {
		margin: 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.pt-termine {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pt-termine li {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}
	.pt-datum {
		display: grid;
		place-items: center;
		flex: none;
		width: 3.9rem;
		height: 3.4rem;
		border-radius: 12px;
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
		line-height: 1.1;
	}
	.pt-datum strong {
		font-family: var(--ui-schrift-titel);
		font-size: 1rem;
	}
	.pt-datum small {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
	}
	.pt-termin-text small {
		color: var(--ui-text-leise);
	}
	.pt-liste,
	.pt-doks,
	.pt-team {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pt-angebot {
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px dashed var(--ui-rand);
	}
	.pt-angebot:last-child {
		border-bottom: 0;
	}
	.pt-zeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.pt-zeile small {
		color: var(--ui-text-leise);
		font-weight: 400;
	}
	.pt-dok {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--ui-text);
		font-weight: 600;
		text-decoration: none;
	}
	.pt-dok:hover {
		color: var(--ui-akzent-text);
		text-decoration: underline;
	}
	.pt-pdf {
		display: inline-grid;
		place-items: center;
		min-width: 2.6rem;
		height: 1.6rem;
		padding: 0 0.35rem;
		border-radius: 6px;
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
		font-size: 0.625rem;
		font-weight: 800;
		letter-spacing: 0.06em;
	}
	.pt-person {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0;
	}
	.pt-person span {
		display: grid;
	}
	.pt-person small {
		color: var(--ui-text-leise);
	}
	.pt-team li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-weight: 600;
	}
	.pt-meldung,
	.pt-ok {
		margin: 0;
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.pt-meldung {
		padding: 0.8rem 1rem;
		border-radius: var(--ui-radius-karte);
		background: color-mix(in srgb, var(--ui-gruen) 10%, white);
	}
	.pt-fehler {
		margin: 0;
		color: var(--ui-gefahr);
	}
	.pt-hinweis {
		margin: 0;
		font-weight: 600;
	}
	.pt-form {
		display: grid;
		gap: 0.75rem;
		padding: 0.9rem;
		border-radius: var(--ui-radius);
		background: var(--ui-akzent-zart);
		border: 1px solid var(--ui-akzent-rand);
	}
	.pt-form label {
		display: grid;
		gap: 0.25rem;
	}
	.pt-form input:not([type='checkbox']),
	.pt-form textarea {
		min-height: 2.75rem;
		font: inherit;
		padding: 0 0.6rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-radius);
	}
	.pt-form textarea {
		padding: 0.6rem;
	}
	.pt-check {
		display: flex !important;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.pt-check input {
		width: 1.4rem;
		height: 1.4rem;
		margin-top: 2px;
		flex: none;
	}
	.pt-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.pt-knopf {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 1.25rem;
		border: 0;
		border-radius: var(--ui-knopf-radius);
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font: inherit;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.pt-knopf:hover {
		background: var(--ui-akzent-hover);
	}
	.pt-knopf.hell {
		background: var(--ui-flaeche);
		color: var(--ui-akzent-text);
		border: 1px solid var(--ui-rand-stark);
	}
	.pt-knopf:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.pt-fuss {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		padding-top: 1rem;
		padding-bottom: 2rem;
		border-top: 1px solid var(--ui-rand);
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.pt-fuss a {
		color: var(--ui-text-leise);
	}
	@keyframes pt-rein {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pt-kachel,
		.pt-karte {
			animation: none;
		}
	}
</style>
