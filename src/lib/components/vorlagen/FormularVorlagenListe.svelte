<script lang="ts">
	import { enhance } from '$app/forms';
	import VorlagenKopf from './VorlagenKopf.svelte';
	import VorlagenListe from './VorlagenListe.svelte';
	import ZeilenAktion from './ZeilenAktion.svelte';
	import { FORMULAR_VORLAGEN, formularVorlagenPfad, type FormularVorlagenArt } from '$lib/formular-vorlagen';

	/**
	 * Inhalt der Seiten „Protokoll-Vorlagen“ und „Aufmaß-Vorlagen“ – Aufbau wie jede Vorlagen-Seite (Jamil msg 3084):
	 * Kopf mit „+ Neue Vorlage“, Liste mit klaren Zeilen-Aktionen, darunter Beispiele und Archiv in derselben Liste.
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
	<title>{art.titel} – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<VorlagenKopf
		titel={art.titel}
		meta={data.art === 'aufmass'
			? 'Aufmaß vor Ort: Räume, Maße, berechnete Flächen und Mengen; verknüpft mit dem Katalog wird daraus mit einem Klick ein Angebot. Jede Änderung wird eine neue Version – begonnene Aufmaße behalten ihre.'
			: 'Formulare für Monteure: Schritte, Pflichtfelder, Fotos, Bedingungen und Unterschrift. Jede Änderung wird eine neue Version – ausgefüllte Protokolle behalten ihre.'}
		neu={{ aktion: '?/neu' }}
	/>

	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.uebernommen != null}<p role="status" class="kd-info">{form.uebernommen} Beispielvorlage(n) übernommen.</p>{/if}

	<div class="fv-bloecke">
		<VorlagenListe eintraege={aktive} leer="Noch keine Vorlage. Legen Sie eine an oder übernehmen Sie ein Beispiel.">
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
	.fv-bloecke {
		display: grid;
		gap: var(--ui-abstand-block, var(--ui-a4));
	}
</style>
