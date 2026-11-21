<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import '$lib/stil/angebote.css';
	import Karte from '$lib/components/Karte.svelte';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { rueckfrage } from '$lib/rueckfrage';
	import { euro, mengeText } from '$lib/geld';
	import { berlinTag, tagDeutsch } from '$lib/zeit';
	import { RECHNUNG_ART_NAMEN, ZAHL_STATUS_KLASSE, ZAHL_STATUS_NAMEN } from '$lib/rechnungen';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const r = $derived(data.rechnung);
	const tag = (iso: string) => tagDeutsch(berlinTag(new Date(iso)));
	const betrag = (c: number | null) => (c === null ? '–' : euro(c));
	const mailto = (an: string | null, betreff: string | null, text: string | null) =>
		`mailto:${an ?? ''}?subject=${encodeURIComponent(betreff ?? '')}&body=${encodeURIComponent(text ?? '')}`;
	const LAUF_STATUS: Record<string, string> = {
		offen: 'Offen',
		freigabe: 'Wartet auf Freigabe',
		wartet: 'Wird in Lexware angelegt',
		bereit: 'Bereit zum Senden',
		gesendet: 'Gesendet',
		gestoppt: 'Gestoppt (bezahlt)',
		fehler: 'Fehler (Lexware prüfen)'
	};
	const vorbereitetText = $derived(
		r.positionen.map((p) => `${p.bezeichnung}: ${mengeText(p.menge)} ${p.einheit} × ${euro(p.einzelpreisCent)} netto`).join('\n') +
			(r.bruttoCent !== null ? `\nBetrag brutto: ${euro(r.bruttoCent)}` : '')
	);
	let kopiert = $state(false);
</script>

<svelte:head>
	<title>{r.nummer ?? RECHNUNG_ART_NAMEN[r.art]} · Rechnung</title>
</svelte:head>

<main class="kd-seite">
	<SeitenKopf
		titel={r.nummer ? `${RECHNUNG_ART_NAMEN[r.art]} ${r.nummer}` : RECHNUNG_ART_NAMEN[r.art]}
		ueberzeile="Rechnung"
		meta={[r.kunde?.name, r.auftrag ? `${r.auftrag.nummer} · ${r.auftrag.titel}` : null, `Datum ${tagDeutsch(r.datum)}`].filter(Boolean).join(' · ')}
		zurueck={r.auftrag ? { href: `/auftraege/${r.auftrag.id}#ausgangsbelege`, text: 'Zum Auftrag' } : { href: '/ausgangsbelege/rechnungen', text: 'Rechnungen' }}
		info="rechnung.seite"
	>
		{#snippet aktionen()}
			{#if r.lexwareLink}<a class="kd-knopf hell" href={r.lexwareLink} target="_blank" rel="noopener" data-testid="rechnung-lexware">In Lexware öffnen</a>{/if}
			{#if data.darf.preise && r.nummer && r.status !== 'entwurf'}<a class="kd-knopf hell" href={`/api/rechnungen/${r.id}/pdf`} target="_blank" rel="noopener">PDF</a>{/if}
			{#if data.darf.preise && r.crm && r.angebotId}<a class="kd-knopf hell" href={`/api/rechnungen/${r.id}/lexware-json`} download title="Rechnung im Format der Lexware-Schnittstelle (nur zum Prüfen, ohne Verbindung)" data-testid="rechnung-lexware-json">Lexware-JSON</a>{/if}
		{/snippet}
		{#snippet zusatz()}<span class={`an-status ${ZAHL_STATUS_KLASSE[r.status]}`} data-testid="rechnung-status">{ZAHL_STATUS_NAMEN[r.status]}</span>{/snippet}
	</SeitenKopf>

	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form && 'gespeichert' in form && form.gespeichert}<p role="status" class="kd-info">{form.gespeichert}</p>{/if}

	<Karte>
		{#snippet titel()}Stand{/snippet}
		<dl class="rg-werte">
			{#if data.darf.preise}
				<div><dt>Betrag</dt><dd>{betrag(r.bruttoCent)}</dd></div>
				<div><dt>Offen</dt><dd data-testid="rechnung-offen">{betrag(r.offenCent)}</dd></div>
			{/if}
			<div><dt>Fällig</dt><dd>{r.faellig ? tagDeutsch(r.faellig) : '–'}</dd></div>
			{#if r.bezahltAm}<div><dt>Bezahlt am</dt><dd>{tagDeutsch(r.bezahltAm)}</dd></div>{/if}
			{#if r.leistungVon}<div><dt>Leistung</dt><dd>{tagDeutsch(r.leistungVon)}{r.leistungBis && r.leistungBis !== r.leistungVon ? ` – ${tagDeutsch(r.leistungBis)}` : ''}</dd></div>{/if}
			{#if r.zahlungszielTage !== null}<div><dt>Zahlungsziel</dt><dd>{r.zahlungszielTage} Tage</dd></div>{/if}
			{#if r.gesendetAm}<div><dt>Gesendet</dt><dd>{tag(r.gesendetAm)}</dd></div>{/if}
		</dl>
		{#if r.status === 'wartet'}
			<p class="kd-info">Die Rechnung wird gerade in Lexware angelegt{r.festschreiben ? ' und festgeschrieben' : ' (als Entwurf)'}.{#each r.schritte as s (s.art + s.seit)}{#if s.fehler} Letzter Fehler: {s.fehler}{/if}{/each}</p>
		{:else if r.status === 'entwurf'}
			<p class="kd-info">Die Rechnung liegt als <strong>Entwurf</strong> in Lexware. Bitte dort prüfen und festschreiben – das CRM bemerkt es von selbst.</p>
		{:else if r.status === 'fehler'}
			<p class="kd-fehler" role="alert">Lexware hat die Rechnung nicht angelegt: {r.fehler}</p>
			{#if data.darf.erstellen}
				<div class="af-ab-knoepfe">
					<form method="POST" action="?/erneut" use:enhance><button class="kd-knopf">Erneut versuchen</button></form>
					<form method="POST" action="?/verwerfen" use:enhance><button class="kd-knopf hell" use:rueckfrage={'Rechnung wirklich verwerfen? In Lexware entsteht nichts.'}>Verwerfen</button></form>
				</div>
			{/if}
		{:else if r.status === 'vorbereitet'}
			<p class="kd-info">
				Abschlags- und Schlussrechnungen lassen sich über die Lexware-Schnittstelle nicht anlegen. Das CRM hat Betrag und Positionen vorbereitet:
				öffnen Sie den Vorgänger in Lexware und legen Sie dort die {RECHNUNG_ART_NAMEN[r.art]} an – danach ordnet der Abgleich sie hier zu.
				<InfoFenster id="rechnung.abschlag" />
			</p>
			<pre class="rg-vorbereitet" data-testid="rechnung-vorbereitet">{vorbereitetText}</pre>
			<div class="af-ab-knoepfe">
				{#if r.vorgaengerLink}<a class="kd-knopf" href={r.vorgaengerLink} target="_blank" rel="noopener" data-testid="in-lexware-fertigstellen">In Lexware fertigstellen</a>{/if}
				<button type="button" class="kd-knopf hell" onclick={async () => { await navigator.clipboard?.writeText(vorbereitetText); kopiert = true; }}>{kopiert ? 'Kopiert' : 'Werte kopieren'}</button>
				{#if data.darf.erstellen}
					<form method="POST" action="?/verwerfen" use:enhance><button class="kd-knopf hell" use:rueckfrage={'Vorbereitung wirklich verwerfen?'}>Verwerfen</button></form>
				{/if}
			</div>
		{:else if data.darf.erstellen && r.nummer && !r.gesendetAm && r.status !== 'storniert'}
			<div class="af-ab-knoepfe" data-testid="rechnung-senden">
				{#if data.postfach}
					<form method="POST" action="?/senden" use:enhance><button class="kd-knopf" use:rueckfrage={`Rechnung ${r.nummer} jetzt an ${data.mail?.an ?? 'den Kunden'} senden?`}>Senden</button></form>
				{/if}
				<a class="kd-knopf hell" href={`/api/rechnungen/${r.id}/pdf?download=1`} download>PDF herunterladen</a>
				{#if data.mail}<a class="kd-knopf hell" href={mailto(data.mail.an, data.mail.betreff, data.mail.text)}>In Mailprogramm öffnen</a>{/if}
				<form method="POST" action="?/gesendet" use:enhance><button class="kd-knopf hell">Als gesendet markieren</button></form>
			</div>
			{#if !data.postfach}<p class="kd-info">Kein Mailversand eingerichtet: PDF herunterladen, im Mailprogramm anhängen und senden.</p>{/if}
		{/if}
	</Karte>

	{#if data.darf.preise && r.zahlungen.length > 0}
		<Karte>
			{#snippet titel()}Zahlungen (aus Lexware){/snippet}
			<ul class="kd-liste" data-testid="rechnung-zahlungen">
				{#each r.zahlungen as z, i (i)}
					<li><span>{z.datum ? tagDeutsch(z.datum) : '–'}</span> · <strong>{euro(z.cent)}</strong> <span class="kd-info">{z.art === 'manualPayment' ? 'Zahlung' : z.art}</span></li>
				{/each}
			</ul>
			<p class="kd-info">Zahlungen bucht nur Lexware (Bankabgleich); das CRM zeigt sie an.</p>
		</Karte>
	{/if}

	{#if r.positionen.length > 0}
		<Karte>
			{#snippet titel()}Positionen (wie an Lexware übergeben){/snippet}
			<ul class="kd-liste">
				{#each r.positionen as p, i (i)}
					<li>{mengeText(p.menge)} {p.einheit} · {p.bezeichnung}{#if data.darf.preise} · {euro(p.einzelpreisCent)} netto{/if}</li>
				{/each}
			</ul>
			<p class="kd-info">Maßgeblich ist der Beleg in Lexware – Änderungen bitte im Lexware-Entwurf.</p>
		</Karte>
	{/if}

	{#if r.crm && r.status !== 'vorbereitet' && r.status !== 'wartet' && r.status !== 'fehler'}
		<Karte>
			{#snippet titel()}Zahlungserinnerung und Mahnungen <InfoFenster id="rechnung.mahnungen" />{/snippet}
			{#if data.darf.mahnen && ['offen', 'teilbezahlt', 'ueberfaellig'].includes(r.status)}
				<form method="POST" action="?/pause" use:enhance class="af-inline" data-testid="mahn-pause">
					<label>Mahnungen pausieren bis <input type="date" name="bis" value={r.pausiertBis ?? ''} /></label>
					<button class="kd-knopf hell klein">Speichern</button>
				</form>
				{#if r.pausiertBis}<p class="kd-info">Pausiert bis {tagDeutsch(r.pausiertBis)}.</p>{/if}
			{/if}
			{#if data.mahnungen.length === 0}
				<p class="kd-info">Noch keine Erinnerung. Die Stufen stellen Sie unter <a href="/einstellungen/mahnungen">Einstellungen → Mahnungen</a> ein.</p>
			{:else}
				<ol class="kd-liste" data-testid="mahn-laeufe">
					{#each data.mahnungen as l (l.id)}
						<li>
							<strong>{l.name}</strong> · {tag(l.angelegt)} · {LAUF_STATUS[l.status] ?? l.status}
							{#if l.gebuehrCent > 0} · Gebühr {euro(l.gebuehrCent)}{/if}
							{#if l.zinsenCent > 0} · Verzugszinsen (Hinweis) {euro(l.zinsenCent)}{/if}
							<div class="af-ab-knoepfe">
								{#if l.status === 'freigabe' && data.darf.mahnen}
									<form method="POST" action="?/freigeben" use:enhance><input type="hidden" name="laufId" value={l.id} /><button class="kd-knopf" use:rueckfrage={`${l.name} freigeben? Sie wird in Lexware angelegt.`}>Mahnung freigeben</button></form>
								{/if}
								{#if l.status === 'bereit' && data.darf.erstellen}
									{#if data.postfach && l.mailAn}<form method="POST" action="?/laufSenden" use:enhance><input type="hidden" name="laufId" value={l.id} /><button class="kd-knopf" use:rueckfrage={`${l.name} an ${l.mailAn} senden?`}>Senden</button></form>{/if}
									{#if l.mailBetreff}<a class="kd-knopf hell klein" href={mailto(l.mailAn, l.mailBetreff, l.mailText)}>In Mailprogramm öffnen</a>{/if}
									{#if l.pdf}<a class="kd-knopf hell klein" href={`/api/mahnungen/${l.id}/pdf?download=1`} download>PDF</a>{/if}
									<form method="POST" action="?/laufGesendet" use:enhance><input type="hidden" name="laufId" value={l.id} /><button class="kd-knopf hell klein">Als gesendet markieren</button></form>
								{/if}
								{#if l.lexwareLink}<a class="kd-knopf hell klein" href={l.lexwareLink} target="_blank" rel="noopener">Mahnung in Lexware</a>{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</Karte>
	{/if}
</main>

<style>
	.rg-werte {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0.75rem;
		margin: 0 0 0.75rem;
	}
	.rg-werte dt {
		font-size: 0.8rem;
		color: var(--m365-text-leise, #666);
	}
	.rg-werte dd {
		margin: 0;
		font-weight: 600;
	}
	.rg-vorbereitet {
		white-space: pre-wrap;
		font-family: inherit;
		background: var(--m365-flaeche, #f5f5f5);
		padding: 0.75rem;
		border-radius: var(--m365-radius, 6px);
	}
</style>
