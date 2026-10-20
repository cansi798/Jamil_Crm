<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import '$lib/stil/kunden.css';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Kundenportal – Einstellungen</title></svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Kundenportal & Auftragsbestätigung</h1>
			<p class="seiten-meta">Links für die Online-Annahme und was nach der Annahme eines Angebots automatisch passiert.</p>
		</div>
	</header>
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.gespeichert}<p role="status" class="kd-info">Gespeichert.</p>{/if}
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
			<label>Link zu Ihren AGB (für das Häkchen bei der Annahme)
				<input type="url" name="agbUrl" value={data.e.agbUrl ?? ''} placeholder="https://www.ihre-firma.de/agb" maxlength="500" />
			</label>
			<label>Link zur Widerrufsbelehrung (optional)
				<input type="url" name="widerrufUrl" value={data.e.widerrufUrl ?? ''} placeholder="https://www.ihre-firma.de/widerruf" maxlength="500" />
			</label>
		</Abschnitt>
		<button type="submit" class="kd-knopf">Speichern</button>
	</form>
</main>
