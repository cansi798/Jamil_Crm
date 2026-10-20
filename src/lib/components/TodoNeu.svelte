<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { REGELN, REGEL_NAMEN } from '$lib/wiederholung';
	import PersonWahl from './ui/PersonWahl.svelte';
	import DatumWahl from './ui/DatumWahl.svelte';
	import StufenWahl from './ui/StufenWahl.svelte';
	import Schalter from './ui/Schalter.svelte';
	import ErinnerungWahl from './ErinnerungWahl.svelte';
	import { page } from '$app/state';

	/**
	 * Formular „To-do anlegen“ im modernen Stil (Jamil msgs 2618/2619): großer Titel oben, darunter Chips für
	 * Zuständig (Avatar), Fällig (Kalender), Lärm/Schmutz (farbige Stufen), Wiederkehrend (Schalter);
	 * Beschreibung auf Klick; „Speichern“ und „Abbrechen“ unten rechts. Feldnamen wie bisher (Server unverändert).
	 */
	let {
		aktion,
		mitarbeiter,
		fehler = null,
		werte = {},
		mitBelastung = false,
		onfertig,
		onabbrechen
	}: {
		aktion: string;
		mitarbeiter: { id: string; name: string }[];
		fehler?: string | null;
		werte?: Record<string, string>;
		/** Auftrags-To-dos: Stufen „Lautstärke“ und „Schmutz“ (gering, mittel, hoch; optional). */
		mitBelastung?: boolean;
		/** Eingeklappt (msg 2579): nach erfolgreichem Speichern bzw. „Abbrechen“ wieder zuklappen. */
		onfertig?: () => void;
		onabbrechen?: () => void;
	} = $props();

	// Wiederholen (Wunsch Jamil, msg 2501): täglich/wöchentlich/monatlich/jährlich, „alle N“, optional bis Datum
	let wiederholen = $state(untrack(() => !!werte.wiederholung));
	let mitBeschreibung = $state(untrack(() => !!werte.beschreibung));
	let zustaendig = $state(untrack(() => werte.zustaendigId ?? ''));
	let faellig = $state(untrack(() => werte.faellig ?? ''));
	let lautstaerke = $state(untrack(() => werte.lautstaerke ?? ''));
	let schmutz = $state(untrack(() => werte.schmutz ?? ''));
	let faelligZeit = $state(untrack(() => werte.faelligZeit ?? ''));
	// Erinnerungen (Wunsch Jamil msg 2679) – nur mit Recht „erinnerungen.nutzen“
	const erinnern = $derived(page.data.erinnern === true);
	let mitErinnerung = $state(untrack(() => !!(werte.erinnerung1 || werte.erinnerung2)));
	let formNr = $state(0);
</script>

<form
	method="POST"
	action={aktion}
	use:enhance={() => async ({ result, update }) => {
		await update();
		if (result.type === 'success') {
			zustaendig = faellig = lautstaerke = schmutz = faelligZeit = '';
			wiederholen = mitBeschreibung = mitErinnerung = false;
			formNr++;
			onfertig?.();
		}
	}}
	class="kd-formular td-neu ui-neu"
>
	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	<input
		class="ui-neu-titel"
		type="text"
		name="titel"
		maxlength="200"
		required
		placeholder="Was ist zu tun? z. B. Material bestellen"
		aria-label="Neues To-do"
		value={werte.titel ?? ''}
	/>
	{#if mitBeschreibung}
		<textarea
			name="beschreibung"
			maxlength="500"
			rows="2"
			placeholder="Details, z. B. Schlüssel beim Nachbarn abholen"
			aria-label="Beschreibung (optional)">{werte.beschreibung ?? ''}</textarea
		>
	{/if}

	<div class="ui-neu-meta" role="group" aria-label="Details zum To-do">
		<PersonWahl name="zustaendigId" personen={mitarbeiter} bind:wert={zustaendig} />
		<DatumWahl name="faellig" bind:wert={faellig} />
		{#if faellig}
			<label class="td-zeit">
				<span class="kd-unsichtbar-text">Uhrzeit</span>
				<input type="time" name="faelligZeit" bind:value={faelligZeit} aria-label="Uhrzeit (optional)" step="300" />
			</label>
		{/if}
		{#if mitBelastung}
			<StufenWahl name="lautstaerke" label="Lautstärke" bind:wert={lautstaerke} />
			<StufenWahl name="schmutz" label="Schmutz" bind:wert={schmutz} />
		{/if}
		<Schalter label="Wiederkehrend (z. B. Wartung)" klasse="kd-haken" bind:an={wiederholen} />
		{#if !mitBeschreibung}
			<button type="button" class="knopf-ghost ui-neu-plus" onclick={() => (mitBeschreibung = true)}>+ Beschreibung</button>
		{/if}
		{#if erinnern && !mitErinnerung}
			<button type="button" class="knopf-ghost ui-neu-plus" onclick={() => (mitErinnerung = true)}>🔔 Erinnern</button>
		{/if}
	</div>

	{#if erinnern && mitErinnerung}
		{#key formNr}
			<div class="td-erinnern" role="group" aria-label="Erinnerungen">
				<ErinnerungWahl name="erinnerung1" label="🔔 Erinnern" wert={werte.erinnerung1 ?? '1440'} />
				<ErinnerungWahl name="erinnerung2" label="und" wert={werte.erinnerung2 ?? ''} />
				<span class="kd-info">„vorher“ bezieht sich auf „Fällig“ (ohne Uhrzeit 8:00).</span>
			</div>
		{/key}
	{/if}

	{#if wiederholen}
		<div class="ui-neu-regel">
			<label>
				Rhythmus
				<select name="wiederholung">
					{#each REGELN as r (r)}<option value={r} selected={(werte.wiederholung || 'monatlich') === r}>{REGEL_NAMEN[r]}</option>{/each}
				</select>
			</label>
			<label>
				alle …
				<input type="number" name="intervall" min="1" max="365" value={werte.intervall || '1'} />
			</label>
			<label>
				bis (optional)
				<input type="date" name="wiederholungEnde" value={werte.wiederholungEnde ?? ''} />
			</label>
			<p class="kd-info">Erster Termin ist „Fällig“ (sonst heute). Beim Abhaken entsteht automatisch das nächste To-do.</p>
		</div>
	{/if}

	<div class="ui-neu-fuss">
		{#if onabbrechen}<button type="button" class="knopf-ghost" onclick={() => onabbrechen?.()}>Abbrechen</button>{/if}
		<button type="submit" class="kd-knopf" aria-label="To-do speichern">Speichern</button>
	</div>
</form>

<style>
	.td-zeit input {
		min-height: 2.5rem;
		width: auto !important;
	}
	.kd-unsichtbar-text {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.td-erinnern {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin-top: 0.5rem;
	}
	.ui-neu {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: stretch;
		gap: 0.75rem;
		padding: 0.25rem 0 0;
	}
	.ui-neu-titel {
		min-height: 3rem !important;
		padding: 0 0.9rem !important;
		font-size: 1.0625rem !important;
		font-weight: 500;
	}
	.ui-neu-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.ui-neu-plus {
		color: var(--ui-akzent-text) !important;
	}
	.ui-neu-regel {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem 0.75rem;
		padding: 0.75rem;
		border-radius: var(--ui-radius);
		background: var(--ui-band);
	}
	.ui-neu-regel .kd-info {
		grid-column: 1 / -1;
		margin: 0;
	}
	.ui-neu-fuss {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.25rem;
	}
</style>
