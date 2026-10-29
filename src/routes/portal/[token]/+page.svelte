<script lang="ts">
	import { enhance } from '$app/forms';
	import PortalFigur from '$lib/components/portal/PortalFigur.svelte';
	import PortalHuelle from '$lib/components/portal/PortalHuelle.svelte';
	import { PORTAL_STUFEN, portalStatusText } from '$lib/portal-status';
	import FortschrittsWeg from '$lib/components/portal/FortschrittsWeg.svelte';
	import PortalSchritte from '$lib/components/portal/PortalSchritte.svelte';
	import BestandskundenKarte from '$lib/components/portal/BestandskundenKarte.svelte';
	import SkizzenKreis from '$lib/components/portal/SkizzenKreis.svelte';
	import SkizzenRahmen from '$lib/components/portal/SkizzenRahmen.svelte';
	import { euro } from '$lib/geld';
	import { tagDeutsch, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	/**
	 * Kundenportal (Jamil msgs 2848, 2851, 2953, 2958) – mobil zuerst:
	 * 1. drei kleine Kacheln: Ihr nächster Termin · Damit wir weitermachen können · Alle Dokumente an einem Ort (msg 3131)
	 * 2. „Ihre Entscheidung – Damit wir weitermachen können“ (nur wenn etwas offen ist): offene Angebote mit „Annehmen“
	 * 3. je Auftrag: Fortschrittsweg, Arbeitsschritte, Termine; persönlicher Projektbegleiter (msg 3120) und Team
	 * 4. EIN Bereich „Ihre Unterlagen“: Angebote, Auftragsbestätigungen, (Rechnungen), Protokolle, Fotos, Dokumente –
	 *    neueste zuerst, mit Art-Etikett, Filter-Chips, bei mehreren Aufträgen nach Auftrag gruppiert.
	 * Aussehen je Betrieb (Hausfarbe, dunkle Farbe, Hintergrund, Schriften, Großbuchstaben) – z. B. wie die Website.
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.seite);
	const m = $derived(s.betrieb.marke);
	const doc = (art: string, id: string) => `/portal/${data.token}/dokument/${art}/${id}`;
	const webLink = $derived(s.betrieb.web ? (/^https?:\/\//i.test(s.betrieb.web) ? s.betrieb.web : `https://${s.betrieb.web}`) : null);
	const telLink = $derived(s.betrieb.telefon ? `tel:${s.betrieb.telefon.replace(/[^0-9+]/g, '')}` : null);
	const mailLink = (nummer: string) => (s.betrieb.email ? `mailto:${s.betrieb.email}?subject=${encodeURIComponent(`Frage zu ${nummer}`)}` : null);
	/** letztes Wort in der Akzentfarbe – wie die Überschriften der Website */
	const teile = (t: string) => {
		const i = t.lastIndexOf(' ');
		return i < 0 ? { vorn: '', wort: t } : { vorn: t.slice(0, i + 1), wort: t.slice(i + 1) };
	};

	// Annahme: Knopf → Bestätigungsschritt (Name + AGB) → verbindlich annehmen
	let schritt = $state<{ id: string; art: 'annehmen' | 'ablehnen' } | null>(null);
	let sendet = $state(false);

	// Status in Kundensprache (msg 3131) – eine Stelle für Weg und Statuszeile: src/lib/portal-status.ts

	// ── Kacheln oben ──────────────────────────────────────────────────────────────────────────────────────────────
	const offen = $derived(s.auftraege.flatMap((a) => a.angebote.filter((x) => x.annehmbar).map((x) => ({ ...x, auftrag: a.titel }))));
	const naechster = $derived(
		s.auftraege
			.flatMap((a) => (a.termine ?? []).map((t) => ({ ...t, auftrag: a.titel })))
			.sort((x, y) => (x.tag + x.von).localeCompare(y.tag + y.von))[0] ?? null
	);

	// ── Ihre Unterlagen: alles in EINER Liste ─────────────────────────────────────────────────────────────────────
	type Gruppe = 'angebote' | 'rechnungen' | 'dokumente';
	type Unterlage = { schluessel: string; etikett: string; ton: string; gruppe: Gruppe; titel: string; datum: string | null; href: string; extern: boolean; info: string | null; auftragId: string };
	const unterlagen = $derived.by((): Unterlage[] => {
		const l: Unterlage[] = [];
		for (const a of s.auftraege) {
			for (const an of a.angebote) {
				const info =
					an.status === 'angenommen'
						? `✓ Angenommen${an.entscheidung ? ` von ${an.entscheidung.name} am ${tagDeutsch(an.entscheidung.zeit.slice(0, 10))}` : ''}`
						: an.status === 'abgelehnt'
							? 'Abgelehnt'
							: an.annehmbar
								? `Ihre Entscheidung steht aus · gültig bis ${tagDeutsch(an.gueltigBis)}`
								: 'nicht mehr gültig';
				l.push({ schluessel: `an-${an.id}`, etikett: 'Angebot', ton: 'angebot', gruppe: 'angebote', titel: `Angebot ${an.nummer} · ${euro(an.bruttoCent)}`, datum: an.datum, href: doc('angebot', an.id), extern: false, info, auftragId: a.id });
			}
			for (const ab of a.auftragsbestaetigungen) l.push({ schluessel: `ab-${ab.id}`, etikett: 'AB', ton: 'ab', gruppe: 'angebote', titel: `Auftragsbestätigung ${ab.nummer}`, datum: ab.datum, href: doc('ab', ab.id), extern: false, info: null, auftragId: a.id });
			for (const d of a.dateien) {
				const etikett = d.art === 'foto' ? 'Foto' : d.art === 'protokoll' ? 'Protokoll' : 'Dokument';
				l.push({ schluessel: `d-${d.id}`, etikett, ton: 'dokument', gruppe: 'dokumente', titel: d.name, datum: d.datum, href: doc('datei', d.id), extern: false, info: null, auftragId: a.id });
			}
			for (const k of a.links ?? []) l.push({ schluessel: `l-${k.url}`, etikett: 'Link', ton: 'dokument', gruppe: 'dokumente', titel: k.titel, datum: null, href: k.url, extern: true, info: null, auftragId: a.id });
		}
		const sortiert = l.sort((x, y) => (y.datum ?? '').localeCompare(x.datum ?? ''));
		// AGB des Betriebs (msg 3030): einmal, am Ende der Liste (beim ersten Auftrag)
		if (s.agbPdf && s.auftraege.length > 0) {
			sortiert.push({ schluessel: 'agb', etikett: 'AGB', ton: 'dokument', gruppe: 'dokumente', titel: 'Allgemeine Geschäftsbedingungen', datum: s.agbPdf.stand, href: `/portal/${data.token}/agb`, extern: false, info: 'PDF', auftragId: s.auftraege[0].id });
		}
		return sortiert;
	});
	// ── Hinweise von uns (msg 3133): freigegebene Notizen – KEINE Unterlagen, eigener ruhiger Bereich ─────────────────
	const hinweise = $derived(
		s.auftraege
			.flatMap((a) => (a.notizen ?? []).map((n) => ({ ...n, auftrag: a.titel })))
			.sort((x, y) => y.datum.localeCompare(x.datum))
	);
	const FILTER: [Gruppe | 'alle', string][] = [
		['alle', 'Alle'],
		['angebote', 'Angebote'],
		['rechnungen', 'Rechnungen'],
		['dokumente', 'Dokumente']
	];
	let filter = $state<Gruppe | 'alle'>('alle');
	const anzahl = (g: Gruppe | 'alle') => (g === 'alle' ? unterlagen.length : unterlagen.filter((u) => u.gruppe === g).length);
	const sichtbar = $derived(filter === 'alle' ? unterlagen : unterlagen.filter((u) => u.gruppe === filter));
	const gruppen = $derived(
		s.auftraege.length > 1
			? s.auftraege.map((a) => ({ id: a.id, titel: `${a.nummer} · ${a.titel}`, liste: sichtbar.filter((u) => u.auftragId === a.id) })).filter((g) => g.liste.length > 0)
			: [{ id: 'alle', titel: null as string | null, liste: sichtbar }]
	);
	const datumText = (d: string | null) => (d ? tagDeutsch(d.slice(0, 10)) : '');
</script>

<svelte:head>
	<title>{s.betrieb.name} – Ihr Kundenportal</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

{#snippet titel(text: string, ebene: 1 | 2, id?: string)}
	{@const t = teile(text)}
	{#if ebene === 1}<h1 {id}>{t.vorn}<span class="pt-akzent">{t.wort}</span></h1>{:else}<h2 {id}>{t.vorn}<span class="pt-akzent">{t.wort}</span></h2>{/if}
{/snippet}

<!-- Hülle im Portal-Design (gemeinsam mit der Online-Buchung, msg 3662): Kopf wie auf der Passwort-Seite (msgs 3087/3088, 3126) -->
<PortalHuelle
	kopfKlasse="pt-kopf"
	name={s.betrieb.name}
	akzent={data.akzent}
	marke={m}
	logo={s.betrieb.logo ? { src: `/portal/${data.token}/logo?variante=${s.betrieb.logo.variante}`, feld: s.betrieb.logo.feld } : null}
	kontakt={{ telefon: s.betrieb.telefon, email: s.betrieb.email, web: s.betrieb.web }}
>
	<main class="pt-inhalt">
		<section class="pt-dash" aria-label="Überblick">
			<div class="pt-kachel">
				<span class="pt-eyebrow">Ihr nächster Termin</span>
				{#if naechster}
					<strong>{tagKurz(naechster.tag)}</strong>
					<span class="pt-k-info">{naechster.von}–{naechster.bis} Uhr</span>
				{:else}
					<strong>–</strong>
					<span class="pt-k-info">noch nicht geplant</span>
				{/if}
			</div>
			{#if offen.length > 0}
				<div class="pt-kachel hervor">
					<span class="pt-eyebrow">Damit wir weitermachen können</span>
					<strong>{offen.length} {offen.length === 1 ? 'Angebot wartet' : 'Angebote warten'}</strong>
					<a class="pt-k-knopf" href="#zu-erledigen">Ihre Entscheidung steht aus →</a>
				</div>
			{:else}
				<div class="pt-kachel ok">
					<span class="pt-eyebrow">Damit wir weitermachen können</span>
					<strong class="pt-ok-zeile"><SkizzenKreis art="ring" groesse={26} seed={5}><svg class="pt-haken" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.7 3.7 7.3-8" /></svg></SkizzenKreis>Alles erledigt</strong>
					<span class="pt-k-info">nichts offen</span>
				</div>
			{/if}
			<a class="pt-kachel" href="#unterlagen">
				<span class="pt-eyebrow">Alle Dokumente an einem Ort</span>
				<strong>{unterlagen.length}</strong>
				<span class="pt-k-info">ansehen →</span>
			</a>
		</section>

		{#if hinweise.length > 0}
			<section class="pt-karte pt-hinweise" aria-labelledby="hinweise-titel">
				{@render titel('Hinweise von uns', 2, 'hinweise-titel')}
				<ul class="pt-hinweis-liste">
					{#each hinweise as h (h.id)}
						<li class="pt-hinweis">
							<p class="pt-hinweis-text">{h.text}</p>
							<small>{tagDeutsch(h.datum.slice(0, 10))}{h.von ? ` · ${h.von}` : ''}{s.auftraege.length > 1 ? ` · ${h.auftrag}` : ''}</small>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if form?.erledigt}
			<p role="status" class="pt-meldung">{form.erledigt === 'angenommen' ? 'Vielen Dank für Ihren Auftrag! Die Auftragsbestätigung finden Sie gleich unter „Ihre Unterlagen“.' : 'Danke für Ihre Rückmeldung.'}</p>
		{/if}

		{#if offen.length > 0}
			<section class="pt-karte pt-erledigen" id="zu-erledigen" aria-labelledby="zu-erledigen-titel">
				<!-- handgezeichneter Rahmen, solange etwas offen ist (msg 3040) -->
				<SkizzenRahmen seed={4} />
				<span class="pt-eyebrow">Ihre Entscheidung</span>
				{@render titel('Damit wir weitermachen können', 2, 'zu-erledigen-titel')}
				<ul class="pt-liste">
					{#each offen as an (an.id)}
						<li class="pt-offen">
							<div class="pt-zeile">
								<span><strong>Angebot {an.nummer}</strong> · {euro(an.bruttoCent)} inkl. MwSt.<br /><small>{an.auftrag} · gültig bis {tagDeutsch(an.gueltigBis)} · <a href={doc('angebot', an.id)} target="_blank" rel="noopener">PDF ansehen</a></small></span>
							</div>
							{#if form?.angebotId === an.id && form?.fehler}<p role="alert" class="pt-fehler">{form.fehler}</p>{/if}
							{#if schritt?.id === an.id && schritt.art === 'annehmen'}
								<form method="POST" action="?/entscheiden" class="pt-form" use:enhance={() => { sendet = true; return async ({ update }) => { await update(); sendet = false; schritt = null; }; }}>
									<input type="hidden" name="angebotId" value={an.id} /><input type="hidden" name="entscheidung" value="angenommen" />
									<p class="pt-hinweis">Bitte bestätigen: Sie nehmen das Angebot {an.nummer} über {euro(an.bruttoCent)} verbindlich an.</p>
									<label class="pt-check"><input type="checkbox" name="agb" value="ja" required />
										<span>Ich habe die {#if s.agbPdf}<a href={`/portal/${data.token}/agb`} target="_blank" rel="noopener noreferrer">AGB (PDF)</a>{:else if s.agbUrl}<a href={s.agbUrl} target="_blank" rel="noopener noreferrer">AGB</a>{:else}AGB{/if} gelesen und akzeptiere sie.{#if s.widerrufUrl} Hinweise zum <a href={s.widerrufUrl} target="_blank" rel="noopener noreferrer">Widerrufsrecht</a>.{/if}</span></label>
									<div class="pt-knoepfe">
										<button type="button" class="pt-knopf hell" onclick={() => (schritt = null)}>Zurück</button>
										<button type="submit" class="pt-knopf" disabled={sendet}>Verbindlich annehmen</button>
									</div>
								</form>
							{:else if schritt?.id === an.id && schritt.art === 'ablehnen'}
								<form method="POST" action="?/entscheiden" class="pt-form" use:enhance={() => { sendet = true; return async ({ update }) => { await update(); sendet = false; schritt = null; }; }}>
									<input type="hidden" name="angebotId" value={an.id} /><input type="hidden" name="entscheidung" value="abgelehnt" />
									<label>Grund (freiwillig) <textarea name="grund" maxlength="1000" rows="3"></textarea></label>
									<div class="pt-knoepfe">
										<button type="button" class="pt-knopf hell" onclick={() => (schritt = null)}>Zurück</button>
										<button type="submit" class="pt-knopf hell" disabled={sendet}>Angebot ablehnen</button>
									</div>
								</form>
							{:else}
								<div class="pt-knoepfe">
									<button type="button" class="pt-knopf hell" onclick={() => (schritt = { id: an.id, art: 'ablehnen' })}>Ablehnen</button>
									<button type="button" class="pt-knopf" aria-label={`Angebot annehmen: ${an.nummer}`} onclick={() => (schritt = { id: an.id, art: 'annehmen' })}>Annehmen</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#each s.auftraege as a (a.id)}
			<section class="pt-auftrag" aria-labelledby={`t-${a.id}`}>
				<div class="pt-haupt">
					<div class="pt-karte pt-titelkarte">
						<span class="pt-eyebrow">Auftrag {a.nummer}</span>
						<h1 id={`t-${a.id}`}>{a.titel}</h1>
						{#if a.status}
							<p class="pt-status" data-testid="portal-status">{a.status.name}</p>
							<!-- kurze Erklärung zum Status (Jamil msg 3135) -->
							{@const erkl = portalStatusText(a.status.schluessel, !!a.schritte && a.schritte.length > 0)}
							<p class="pt-status-text" data-testid="portal-status-text">
								{erkl.text}{#if erkl.schritteLink}
									<a href={`#schritte-${a.id}`}>{erkl.schritteLink}</a>.{/if}
							</p>
							<FortschrittsWeg stufen={PORTAL_STUFEN} aktuell={a.status.schluessel} />
						{/if}
					</div>

					{#if a.schritte && a.schritte.length > 0}
						<div class="pt-karte" id={`schritte-${a.id}`}>
							<span class="pt-eyebrow">Damit Sie planen können</span>
							{@render titel('Die Arbeitsschritte', 2)}
							<p class="pt-leise">Wie laut und wie staubig es bei den einzelnen Schritten wird.</p>
							<PortalSchritte schritte={a.schritte} />
						</div>
					{/if}

					{#if a.termine}
						<div class="pt-karte">
							{@render titel('Nächste Termine', 2)}
							{#if a.termine.length === 0}
								<p class="pt-leise">Es ist gerade kein Termin geplant. Wir melden uns bei Ihnen.</p>
							{:else}
								<ul class="pt-termine">
									{#each a.termine as t, i (i)}
										<li>
											<SkizzenKreis art="plakette" groesse={64} seed={i + 2}>
												<span class="pt-datum"><strong>{tagKurz(t.tag).split(' ')[1] ?? tagKurz(t.tag)}</strong><small>{tagKurz(t.tag).split(' ')[0]}</small></span>
											</SkizzenKreis>
											<span class="pt-termin-text"><strong>{t.von}–{t.bis} Uhr</strong> · {t.art}{#if t.mitarbeiter.length}<br /><small>{t.mitarbeiter.join(', ')}</small>{/if}</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</div>

				<aside class="pt-seite" aria-label={`Kontakt zu ${a.titel}`}>
					<div class="pt-karte pt-ansprech">
						{@render titel(a.ansprechpartner?.figur === 'projektbegleiterin' ? 'Ihre persönliche Projektbegleiterin' : 'Ihr persönlicher Projektbegleiter', 2)}
						{#if a.ansprechpartner}
							<p class="pt-person"><PortalFigur figur={a.ansprechpartner.figur} name={a.ansprechpartner.name} groesse={60} /><span><strong>{a.ansprechpartner.name}</strong><small>{s.betrieb.name}</small></span></p>
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
							{@render titel('Ihr Team', 2)}
							<ul class="pt-team">
								{#each a.team as person (person.name)}<li><PortalFigur figur={person.figur} name={person.name} groesse={44} /><span>{person.name}</span></li>{/each}
							</ul>
						</div>
					{/if}
				</aside>
			</section>
		{:else}
			<section class="pt-karte"><p>Hier ist gerade nichts freigegeben.</p></section>
		{/each}

		<section class="pt-karte pt-unterlagen" id="unterlagen" aria-labelledby="unterlagen-titel">
			<span class="pt-eyebrow">Alles an einem Ort</span>
			{@render titel('Ihre Unterlagen', 2, 'unterlagen-titel')}
			<div class="pt-chips" role="group" aria-label="Unterlagen filtern">
				{#each FILTER as [wert, text] (wert)}
					<button type="button" aria-pressed={filter === wert} onclick={() => (filter = wert)}>{text} <small>{anzahl(wert)}</small></button>
				{/each}
			</div>
			{#each gruppen as g (g.id)}
				{#if g.titel}<h3 class="pt-gruppe">{g.titel}</h3>{/if}
				<ul class="pt-doks">
					{#each g.liste as u (u.schluessel)}
						<li>
							<a class="pt-dok" href={u.href} target="_blank" rel={u.extern ? 'noopener noreferrer external' : 'noopener'}>
								<span class={`pt-etikett ${u.ton}`}>{u.etikett}</span>
								<span class="pt-dok-text">
									<span class="pt-dok-titel">{u.titel}</span>
									{#if u.info || u.datum}<small>{[datumText(u.datum), u.info].filter(Boolean).join(' · ')}</small>{/if}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="pt-leise">{filter === 'rechnungen' ? 'Rechnungen erscheinen hier, sobald sie erstellt sind.' : 'Hier ist noch nichts.'}</p>
			{/each}
		</section>

		<!-- Leistungen für Bestandskunden (msg 3408): klein und dezent am Ende, nur wenn eingeschaltet und ein Auftrag abgeschlossen ist -->
		{#if s.bestandskarte}<BestandskundenKarte karte={s.bestandskarte} />{/if}
	</main>

</PortalHuelle>

<style>
	.pt-inhalt {
		display: grid;
		gap: 0.85rem;
		padding-top: 1rem;
		padding-bottom: 2rem;
	}
	/* Drei kleine Kacheln: am Handy nebeneinander, kompakt */
	.pt-dash {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.45rem;
	}
	.pt-kachel {
		display: grid;
		align-content: start;
		gap: 0.15rem;
		min-width: 0;
		padding: 0.55rem 0.6rem;
		border: 1px solid var(--ui-rand);
		border-top: 3px solid var(--ui-akzent);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
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
	a.pt-kachel:hover {
		background: var(--ui-akzent-zart);
	}
	.pt-kachel.hervor {
		background: var(--ui-akzent-hell);
	}
	.pt-kachel.ok {
		border-top-color: var(--ui-gruen);
	}
	.pt-kachel .pt-eyebrow {
		font-size: 0.5625rem;
		letter-spacing: 0.08em;
		line-height: 1.25;
	}
	.pt-kachel strong {
		font-family: var(--pt-titel);
		font-size: 0.95rem;
		line-height: 1.2;
	}
	.pt-k-info,
	.pt-k-knopf {
		color: var(--ui-text-leise);
		font-size: 0.6875rem;
	}
	.pt-k-knopf {
		color: var(--ui-akzent-text);
		font-weight: 700;
	}
	.pt-ok-zeile {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--ui-gruen);
	}
	/* Jamil msg 3028: Haken als SVG statt Schriftzeichen – sitzt so genau mittig im Kreis */
	.pt-haken {
		display: block;
		width: 0.85rem;
		height: 0.85rem;
	}
	.pt-haken path {
		fill: none;
		stroke: var(--ui-gruen);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (min-width: 641px) {
		.pt-dash {
			gap: 0.75rem;
		}
		.pt-kachel {
			padding: 0.8rem 1rem;
		}
		.pt-kachel .pt-eyebrow {
			font-size: 0.6875rem;
		}
		.pt-kachel strong {
			font-size: 1.25rem;
		}
		.pt-k-info,
		.pt-k-knopf {
			font-size: var(--ui-schrift-s);
		}
	}
	/* Auftrag: am Handy untereinander, ab 900 px mit Kontaktspalte */
	.pt-auftrag {
		display: grid;
		gap: 0.85rem;
		align-items: start;
	}
	.pt-haupt,
	.pt-seite {
		display: grid;
		gap: 0.85rem;
	}
	@media (min-width: 900px) {
		.pt-auftrag {
			grid-template-columns: minmax(0, 1fr) 20rem;
		}
		.pt-seite {
			position: sticky;
			top: 1rem;
		}
	}
	h1 {
		margin: 0;
		font-size: clamp(1.35rem, 3vw, 1.9rem);
		line-height: 1.15;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.2;
	}
	.pt-status {
		margin: 0 0 0.25rem;
		color: var(--ui-akzent-text);
		font-weight: 700;
	}
	/* eine ruhige Zeile unter dem Status (msg 3135) */
	.pt-status-text {
		margin: 0 0 0.5rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		line-height: 1.5;
	}
	.pt-status-text a {
		color: var(--ui-akzent-text);
		font-weight: 600;
	}
	.pt-leise {
		margin: 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.pt-termine {
		display: grid;
		gap: 0.6rem;
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
		line-height: 1.05;
	}
	.pt-datum strong {
		font-size: 0.75rem;
	}
	.pt-datum small {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
	}
	.pt-termin-text small {
		color: var(--ui-text-leise);
	}
	.pt-liste,
	.pt-team {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pt-erledigen {
		position: relative;
		border-color: var(--ui-akzent-rand);
		background: var(--ui-akzent-zart);
	}
	.pt-offen {
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-top: 1px dashed var(--ui-akzent-rand);
	}
	.pt-zeile small {
		color: var(--ui-text-leise);
	}
	/* Hinweise von uns (msg 3133) */
	.pt-hinweis-liste {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.pt-hinweis {
		padding: 0.75rem 0.9rem;
		border-left: 3px solid var(--ui-akzent);
		border-radius: 8px;
		background: var(--ui-akzent-zart, #faf7f0);
	}
	.pt-hinweis-text {
		margin: 0 0 0.25rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.pt-hinweis small {
		color: var(--ui-text-leise);
	}
	/* Ihre Unterlagen */
	.pt-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.pt-chips button {
		min-height: 2.25rem;
		padding: 0 0.8rem;
		border: 1px solid var(--ui-rand);
		border-radius: 999px;
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		cursor: pointer;
	}
	.pt-chips button small {
		color: var(--ui-text-leise);
		font-weight: 400;
	}
	/* Aktiver Filter: Hausfarbe mit automatisch lesbarer Schrift (msg 3133 – vorher weiß auf heller Kopffarbe) */
	.pt-chips button[aria-pressed='true'] {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
	}
	.pt-chips button[aria-pressed='true'] small {
		color: inherit;
		opacity: 0.8;
	}
	.pt-chips button:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.pt-gruppe {
		margin: 0.4rem 0 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.pt-doks {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pt-doks li + li {
		border-top: 1px solid var(--ui-rand);
	}
	.pt-dok {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 2.9rem;
		padding: 0.45rem 0.2rem;
		color: var(--ui-text);
		text-decoration: none;
	}
	.pt-dok:hover .pt-dok-titel {
		color: var(--ui-akzent-text);
		text-decoration: underline;
	}
	.pt-dok-text {
		display: grid;
		min-width: 0;
	}
	.pt-dok-titel {
		overflow: hidden;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.pt-dok-text small {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
	}
	.pt-etikett {
		display: inline-grid;
		place-items: center;
		flex: none;
		min-width: 4.6rem;
		height: 1.45rem;
		padding: 0 0.4rem;
		border-radius: 6px;
		font-size: 0.625rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.pt-etikett.angebot {
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
	}
	.pt-etikett.ab {
		background: color-mix(in srgb, var(--ui-gruen) 14%, white);
		color: var(--ui-gruen);
	}
	.pt-etikett.rechnung {
		background: color-mix(in srgb, var(--ui-blau) 14%, white);
		color: var(--ui-blau);
	}
	.pt-etikett.dokument {
		background: var(--ui-grau-hell);
		color: var(--ui-text-leise);
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
	.pt-meldung {
		margin: 0;
		padding: 0.8rem 1rem;
		border-radius: var(--ui-radius-karte);
		background: color-mix(in srgb, var(--ui-gruen) 10%, white);
		color: var(--ui-gruen);
		font-weight: 600;
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
		background: var(--ui-flaeche);
		border: 1px solid var(--ui-akzent-rand);
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
	/* Knöpfe: Hauptaktion rechts */
	.pt-knoepfe {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.pt-ansprech .pt-knoepfe {
		justify-content: flex-start;
	}
	/* Einblenden: @keyframes pt-rein steht in PortalHuelle (global) */
	@media (prefers-reduced-motion: reduce) {
		.pt-kachel {
			animation: none;
		}
	}
</style>
