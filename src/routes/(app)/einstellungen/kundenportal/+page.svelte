<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import '$lib/stil/kunden.css';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const tagZeit = (iso: string) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
</script>

<svelte:head><title>Kundenportal – Einstellungen</title></svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Kundenportal & Auftragsbestätigung</h1>
			<p class="seiten-meta">Links für die Online-Annahme und was nach der Annahme eines Angebots automatisch passiert.</p>
		</div>
	</header>
	{#if form?.fehler && !form?.agbFehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.gespeichert}<p role="status" class="kd-info">Gespeichert.</p>{/if}

	<Abschnitt titel="AGB als PDF">
		<p class="kd-info">
			Die AGB stehen im Kundenportal beim Häkchen „Ich habe die AGB (PDF) gelesen …“ als Link und unter „Ihre Unterlagen“.
			Bei jeder Annahme wird festgehalten, welche Fassung der Kunde bestätigt hat.
		</p>
		{#if data.agbPdf}
			<p class="ag-datei" data-testid="agb-pdf">
				<a href="/api/einstellungen/kundenportal/agb" target="_blank" rel="noopener">AGB (PDF) ansehen</a>
				· {Math.max(1, Math.round(data.agbPdf.groesse / 1024))} KB · hochgeladen am {tagZeit(data.agbPdf.hochgeladen)}
				· Fassung {data.agbPdf.hash.slice(0, 12)}…
			</p>
		{:else}
			<p class="kt-hinweis warnung" role="note">Ohne hinterlegte AGB gelten sie nicht als wirksam einbezogen.</p>
		{/if}
		{#if form?.agbFehler && form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
		{#if form?.agbGespeichert}<p role="status" class="kd-info">AGB gespeichert.</p>{/if}
		<form method="POST" action="?/agb" enctype="multipart/form-data" use:enhance class="kd-formular">
			<label>{data.agbPdf ? 'Neue Fassung hochladen (ersetzt die bisherige)' : 'AGB hochladen'} – PDF, höchstens 5 MB
				<input type="file" name="agb" accept="application/pdf,.pdf" required />
			</label>
			<div class="kd-aktionen"><button type="submit" class="kd-knopf">{data.agbPdf ? 'AGB ersetzen' : 'AGB hochladen'}</button></div>
		</form>
		{#if data.agbPdf}
			<form method="POST" action="?/agbLoeschen" use:enhance>
				<button type="submit" class="kd-knopf hell">AGB entfernen</button>
			</form>
		{/if}
	</Abschnitt>
	<form method="POST" use:enhance={() => async ({ update }) => update({ reset: false })} class="kd-formular">
		<Abschnitt titel="Auftragsbestätigung">
			<Schalter name="abAutomatisch" an={data.e.abAutomatisch} label="Auftragsbestätigung automatisch erstellen" hinweis="Sobald ein Angebot angenommen ist (Kundenportal, Büro oder Sprache): PDF am Auftrag, im Portal sichtbar, Versand vorbereitet. Je Auftrag abschaltbar." />
		</Abschnitt>
		<Abschnitt titel="Kundenportal">
			{#if !data.portalModul}<p class="kd-info">Das Kundenportal ist im aktuellen Tarif nicht enthalten – die Links gelten erst mit dem Modul.</p>{/if}
			<label>Welche Aufträge stehen im Portal?
				<Auswahl name="standard">
					<option value="alle_aktiven" selected={data.e.standard === 'alle_aktiven'}>alle aktiven Aufträge des Kunden (nicht abgerechnet)</option>
					<option value="nur_markierte" selected={data.e.standard === 'nur_markierte'}>nur Aufträge mit „Im Portal zeigen: ja“</option>
				</Auswahl>
			</label>
			<p class="kd-info">Je Auftrag überschreibbar (Karte „Kundenportal“ im Auftrag). Den Link erzeugen Sie auf der Seite des Kunden.</p>
			<label>Namen von Ansprechpartner und Team im Portal
				<Auswahl name="teamNamen">
					<option value="vorname" selected={data.e.teamNamen === 'vorname'}>nur Vorname (z. B. „Sabine“)</option>
					<option value="voll" selected={data.e.teamNamen === 'voll'}>Vor- und Nachname (z. B. „Sabine Schäfer“)</option>
					<option value="aus" selected={data.e.teamNamen === 'aus'}>keine Namen zeigen</option>
				</Auswahl>
			</label>
			<p class="kd-info">Der Kunde sieht, wer sein Ansprechpartner ist und wer am Auftrag arbeitet. Je Auftrag abschaltbar („Namen der Mitarbeiter“).</p>
			<label>Link zu Ihren AGB (nur, wenn oben kein PDF hinterlegt ist)
				<input type="url" name="agbUrl" value={data.e.agbUrl ?? ''} placeholder="https://www.ihre-firma.de/agb" maxlength="500" />
			</label>
			<label>Link zur Widerrufsbelehrung (optional)
				<input type="url" name="widerrufUrl" value={data.e.widerrufUrl ?? ''} placeholder="https://www.ihre-firma.de/widerruf" maxlength="500" />
			</label>
		</Abschnitt>
		<button type="submit" class="kd-knopf">Speichern</button>
	</form>
</main>
