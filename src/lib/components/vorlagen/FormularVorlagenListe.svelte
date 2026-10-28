<script lang="ts">
	import { enhance } from '$app/forms';
	import VorlagenKopf from './VorlagenKopf.svelte';
	import VorlagenListe from './VorlagenListe.svelte';
	import ZeilenAktion from './ZeilenAktion.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import { FORMULAR_VORLAGEN, formularVorlagenPfad, type FormularVorlagenArt } from '$lib/formular-vorlagen';

	/**
	 * EIN Menüpunkt „Protokoll- & Aufmaß-Vorlagen“ (Jamil msgs 3533/3535) mit zwei Reitern Protokolle | Aufmaße – jede Art behält
	 * ihre Adresse (/einstellungen/protokoll-vorlagen, /einstellungen/aufmass-vorlagen). Aufbau wie jede Vorlagen-Seite (msg 3084):
	 * Kopf mit „+ Neue Vorlage“ (legt eine Vorlage der Art des gewählten Reiters an), Liste mit klaren Zeilen-Aktionen, darunter
	 * Beispiele und Archiv in derselben Liste.
	 */
	type Kurz = { id: string; name: string; beschreibung: string | null; version: number; seiten: number; felder: number; protokolle: number; geaendert: string; archiviert: boolean };
	let {
		data,
		form
	}: {
		data: { art: FormularVorlagenArt; vorlagen: Kurz[]; beispiele: { schluessel: string; name: string; beschreibung: string }[] };
		form: { fehler?: string; uebernommen?: number } | null;
	} = $props();

	const art = $derived(FORMULAR_VORLAGEN[data.art]);
	const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
	const mehr = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
	const zeile = (v: Kurz) => ({
		id: v.id,
		name: v.name,
		href: formularVorlagenPfad(data.art, v.id),
		meta: [
			`Version ${v.version}`,
			mehr(v.seiten, 'Schritt', 'Schritte'),
			mehr(v.felder, 'Feld', 'Felder'),
			`geändert ${datum(v.geaendert)}`,
			v.protokolle > 0 ? mehr(v.protokolle, art.ding, art.mehrere) : null
		]
			.filter(Boolean)
			.join(' · '),
		beschreibung: v.beschreibung
	});
	const aktive = $derived(data.vorlagen.filter((v) => !v.archiviert).map(zeile));
	const archivierte = $derived(data.vorlagen.filter((v) => v.archiviert).map(zeile));
	const beispiele = $derived(data.beispiele.map((b) => ({ id: b.schluessel, name: b.name, beschreibung: b.beschreibung })));
</script>

<svelte:head>
	<title>{art.titel} – Protokoll- & Aufmaß-Vorlagen</title>
</svelte:head>

<main class="kd-seite breit">
	<VorlagenKopf
		titel="Protokoll- & Aufmaß-Vorlagen"
		meta={data.art === 'aufmass' ? 'Aufmaß vor Ort: Räume, Maße, Flächen – mit dem Katalog direkt zum Angebot.' : 'Formulare für Monteure: Schritte, Pflichtfelder, Fotos und Unterschrift.'}
		neu={{ aktion: '?/neu' }}
		info={data.art === 'aufmass' ? 'aufmass-vorlagen.seite' : 'protokoll-vorlagen.seite'}
	/>

	<div class="fv-reiter">
		<Umschalter
			label="Art der Vorlagen"
			aktiv={data.art}
			eintraege={[
				{ wert: 'protokoll', text: 'Protokolle', href: FORMULAR_VORLAGEN.protokoll.pfad },
				{ wert: 'aufmass', text: 'Aufmaße', href: FORMULAR_VORLAGEN.aufmass.pfad }
			]}
		/>
		<span class="kd-info">„+ Neue Vorlage“ legt {data.art === 'aufmass' ? 'ein Aufmaß' : 'ein Protokoll'} an – die Art wählen Sie mit dem Reiter.</span>
	</div>

	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.uebernommen != null}<p role="status" class="kd-info">{form.uebernommen} Beispielvorlage(n) übernommen.</p>{/if}

	<div class="fv-bloecke">
		<VorlagenListe
			eintraege={aktive}
			hinweis={`Jede Änderung wird eine neue Version – ${data.art === 'aufmass' ? 'begonnene Aufmaße' : 'ausgefüllte Protokolle'} behalten ihre.`}
			leer="Noch keine Vorlage. Legen Sie eine an oder übernehmen Sie ein Beispiel.">
			{#snippet aktionen(v)}
				<ZeilenAktion aktion="?/duplizieren" id={v.id} symbol="kopieren">Duplizieren</ZeilenAktion>
				<ZeilenAktion aktion="?/archivieren" id={v.id} symbol="archiv">Archivieren</ZeilenAktion>
			{/snippet}
		</VorlagenListe>

		{#if beispiele.length > 0}
			<VorlagenListe titel="Beispiele" hinweis="Fertige Vorlagen zum Übernehmen – danach frei änderbar." eintraege={beispiele} leer="">
				{#snippet kopfAktionen()}
					<form method="POST" action="?/beispiele" use:enhance>
						<button type="submit" class="kd-knopf hell klein" data-testid="beispiele-uebernehmen">Beispiele übernehmen</button>
					</form>
				{/snippet}
			</VorlagenListe>
		{/if}

		{#if archivierte.length > 0}
			<VorlagenListe titel="Archiviert" hinweis="Archivierte Vorlagen lassen sich nicht mehr starten; ausgefüllte bleiben erhalten." eintraege={archivierte} leer="">
				{#snippet aktionen(v)}
					<ZeilenAktion aktion="?/wiederherstellen" id={v.id} symbol="wiederherstellen">Wiederherstellen</ZeilenAktion>
				{/snippet}
			</VorlagenListe>
		{/if}
	</div>
</main>

<style>
	.fv-reiter {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-bottom: 1rem;
	}
	.fv-bloecke {
		display: grid;
		gap: var(--ui-abstand-block, var(--ui-a4));
	}
</style>
