<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import { enhance } from '$app/forms';
	import { rueckfrage } from '$lib/rueckfrage';
	import '$lib/stil/kunden.css';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.status);
	const fehler = (aktion: string) => (form && 'fehler' in form && form.aktion === aktion ? form.fehler : null);
	const erfolg = (aktion: string) => (form && 'ergebnis' in form && form.aktion === aktion ? String(form.ergebnis) : null);
	const zeit = (iso: string) =>
		new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	const datum = (t: string) => new Date(`${t}T12:00:00`).toLocaleDateString('de-DE');
	const STATUS: Record<string, string> = {
		nicht_verbunden: 'Nicht verbunden',
		verbunden: 'Verbunden',
		schluessel_ungueltig: 'Schlüssel ungültig oder abgelaufen',
		fehler: 'Fehler bei der Verbindung'
	};
	const AUFTRAG: Record<string, string> = { wartet: 'wartet', laeuft: 'läuft', ungewiss: 'wird geprüft (Ausgang unklar)', pruefen: 'bitte prüfen' };
	const behalten = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>Lexware verbinden</title>
</svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Lexware verbinden</h1>
			<p class="seiten-meta"><span class="meta-text">Lexware Office als Belegsystem: Kunden, Angebote, Rechnungen und Zahlungen</span><InfoFenster id="lexware.seite" /></p>
		</div>
	</header>

	<section class="lx-karte" aria-label="Stand">
		<p class={s.status === 'verbunden' ? 'kd-info' : s.schluesselGesetzt ? 'kd-fehler' : 'kd-info'} role="status">
			<strong>{STATUS[s.status]}</strong>{#if s.firmenname} – {s.firmenname}{/if}
			{#if s.geprueftAm}<br /><small>geprüft {zeit(s.geprueftAm)}</small>{/if}
			{#if s.letzterFehler && s.status !== 'verbunden'}<br />{s.letzterFehler}{/if}
		</p>
		{#if s.status === 'verbunden'}
			<ul class="lx-liste">
				<li>Steuerart in Lexware: {s.steuerart ?? '–'}{s.kleinunternehmer ? ' · Kleinunternehmer (§ 19 UStG)' : ''}</li>
				<li>Schlüssel {s.schluesselHinweis}{#if s.gueltigBis}, gültig bis {datum(s.gueltigBis)}{/if}</li>
				<li>Belege im Spiegel: {s.belege}{#if s.letzterAbgleich} · letzter Abgleich {zeit(s.letzterAbgleich)}{/if}</li>
			</ul>
		{/if}
		{#if s.laeuftBaldAb}
			<p class="kd-fehler" role="alert">{s.tageBisAblauf !== null && s.tageBisAblauf < 0 ? 'Der Lexware-Schlüssel ist abgelaufen.' : `Der Lexware-Schlüssel läuft in ${s.tageBisAblauf} Tagen ab.`} Bitte in Lexware einen neuen anlegen und hier eintragen.</p>
		{/if}
		{#if !data.geheimnisBereit}
			<p class="kd-fehler">Auf dem Server fehlt der Schlüssel für Zugangsdaten (CRM_GEHEIMNIS_SCHLUESSEL) – der Lexware-Schlüssel lässt sich erst danach speichern.</p>
		{/if}
	</section>

	<section class="lx-karte">
		<h2>API-Schlüssel <InfoFenster id="lexware.schluessel" /></h2>
		<form method="POST" action="?/schluessel" use:enhance class="lx-form">
			<label>Schlüssel aus Lexware (Erweiterungen → Public API)
				<input name="schluessel" type="password" autocomplete="off" maxlength="500" required placeholder={s.schluesselGesetzt ? `gespeichert (${s.schluesselHinweis}) – neuen einfügen zum Ersetzen` : 'Schlüssel einfügen'} />
			</label>
			<label>Gültig bis (optional, Standard 24 Monate)<input name="gueltigBis" type="date" /></label>
			{#if fehler('schluessel')}<p role="alert" class="kd-fehler">{fehler('schluessel')}</p>{/if}
			{#if erfolg('schluessel')}<p class="kd-info" role="status">Gespeichert – {STATUS[erfolg('schluessel') ?? ''] ?? erfolg('schluessel')}.</p>{/if}
			<div class="lx-knoepfe"><button type="submit" class="kd-knopf">Speichern und verbinden</button></div>
		</form>
		{#if s.schluesselGesetzt}
			<div class="lx-knoepfe">
				<form method="POST" action="?/pruefen" use:enhance><button type="submit" class="kd-knopf hell">Verbindung prüfen</button></form>
				<form method="POST" action="?/trennen" use:enhance use:rueckfrage={{ frage: 'Verbindung zu Lexware trennen? Der Schlüssel wird gelöscht.', ja: 'Trennen' }}>
					<button type="submit" class="kd-knopf hell">Verbindung trennen</button>
				</form>
			</div>
			{#if fehler('pruefen') || fehler('trennen')}<p role="alert" class="kd-fehler">{fehler('pruefen') ?? fehler('trennen')}</p>{/if}
		{/if}
	</section>

	{#if s.status === 'verbunden'}
		<section class="lx-karte">
			<h2>Rückmeldungen von Lexware <InfoFenster id="lexware.rueckmeldungen" /></h2>
			{#if s.webhookUrl}
				<p class="kd-info">Adresse: <code>{s.webhookUrl}</code> · eingerichtet: {s.abos}</p>
				<form method="POST" action="?/abos" use:enhance><button type="submit" class="kd-knopf hell">Rückmeldungen einrichten</button></form>
			{:else}
				<p class="kd-info">Rückmeldungen gehen erst, wenn das CRM öffentlich per HTTPS erreichbar ist. Bis dahin gleicht das CRM nachts und auf Knopfdruck ab.</p>
			{/if}
			{#if fehler('abos')}<p role="alert" class="kd-fehler">{fehler('abos')}</p>{/if}
			{#if erfolg('abos')}<p class="kd-info" role="status">Wird eingerichtet – gleich unter „Warteschlange“ zu sehen.</p>{/if}
		</section>

		<section class="lx-karte">
			<h2>Kunden und Belege abgleichen <InfoFenster id="lexware.abgleich" /></h2>
			<form method="POST" action="?/kundenAnlegen" use:enhance={behalten} class="lx-form">
				<Schalter name="an" an={s.kundenAnlegen} label="Fehlende Kunden in Lexware anlegen" info="lexware.kunden_anlegen" hinweis="Aus: Der Abgleich verknüpft nur Kunden, die es in Lexware schon gibt (gleiche E-Mail)." />
				<div class="lx-knoepfe"><button type="submit" class="kd-knopf hell">Speichern</button></div>
			</form>
			<div class="lx-knoepfe">
				<form method="POST" action="?/abgleich" use:enhance><button type="submit" class="kd-knopf">Lexware-Abgleich starten</button></form>
				<form method="POST" action="?/jetzt" use:enhance><button type="submit" class="kd-knopf hell">Warteschlange jetzt ausführen</button></form>
			</div>
			{#if fehler('abgleich') || fehler('jetzt') || fehler('kundenAnlegen')}<p role="alert" class="kd-fehler">{fehler('abgleich') ?? fehler('jetzt') ?? fehler('kundenAnlegen')}</p>{/if}
			{#if erfolg('abgleich')}<p class="kd-info" role="status">Abgleich eingestellt – läuft im Hintergrund.</p>{/if}
			{#if erfolg('jetzt')}<p class="kd-info" role="status">Ausgeführt: {erfolg('jetzt')}.</p>{/if}
		</section>
	{/if}

	{#if s.schluesselGesetzt}
		<section class="lx-karte">
			<h2>Warteschlange <InfoFenster id="lexware.warteschlange" /></h2>
			{#if data.auftraege.length === 0}
				<p class="kd-info">Nichts offen.</p>
			{:else}
				<ul class="lx-zeilen">
					{#each data.auftraege as a (a.id)}
						<li>
							<span><strong>{a.name}</strong> – {AUFTRAG[a.status] ?? a.status}{a.versuche ? ` (Versuch ${a.versuche})` : ''}</span>
							{#if a.letzterFehler}<span class="lx-fehler">{a.letzterFehler}</span>{/if}
							<span class="lx-knoepfe">
								<form method="POST" action="?/erneut" use:enhance><input type="hidden" name="id" value={a.id} /><button type="submit" class="kd-knopf hell">Erneut versuchen</button></form>
								<form method="POST" action="?/abbrechen" use:enhance use:rueckfrage={{ frage: 'Diesen Auftrag an Lexware abbrechen?', ja: 'Abbrechen' }}>
									<input type="hidden" name="id" value={a.id} /><button type="submit" class="kd-knopf hell">Abbrechen</button>
								</form>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="lx-karte">
			<h2>Protokoll <InfoFenster id="lexware.protokoll" /></h2>
			{#if data.protokoll.length === 0}
				<p class="kd-info">Noch keine Anfragen.</p>
			{:else}
				<ul class="lx-zeilen">
					{#each data.protokoll as p, i (i)}
						<li><span class="lx-zeit">{zeit(p.zeit)}</span><span>{p.methode} {p.pfad} → {p.status ?? 'keine Antwort'} ({p.dauerMs} ms)</span>{#if p.fehler}<span class="lx-fehler">{p.fehler}</span>{/if}</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</main>

<style>
	.lx-karte {
		margin: 1rem 0;
		padding: 1rem 1.25rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
		overflow-wrap: anywhere;
	}
	.lx-karte h2 {
		margin: 0 0 0.75rem;
		font-size: 1.05rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.lx-form {
		display: grid;
		gap: 0.75rem;
	}
	.lx-form label {
		display: grid;
		gap: 0.25rem;
	}
	.lx-form input {
		min-width: 0;
	}
	.lx-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.lx-liste {
		line-height: 1.7;
		padding-left: 1.2rem;
		margin: 0.5rem 0;
	}
	.lx-zeilen {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.lx-zeilen li {
		display: grid;
		gap: 0.2rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--m365-rand-stark);
	}
	.lx-zeit {
		font-size: 0.85rem;
		color: var(--m365-text-2, #555);
	}
	.lx-fehler {
		color: var(--m365-fehler, #a4262c);
		font-size: 0.9rem;
	}
</style>
