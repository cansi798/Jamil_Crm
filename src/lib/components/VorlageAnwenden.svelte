<script lang="ts">
	import { enhance } from '$app/forms';
	import Auswahl from './ui/Auswahl.svelte';
	import Segmente from './ui/Segmente.svelte';
	import PersonWahl from './ui/PersonWahl.svelte';
	import FormFuss from './ui/FormFuss.svelte';
	import ZeitraumWahl from './ZeitraumWahl.svelte';
	import { personenMitVorschlag, vorlageAufteilen, titelSchluessel, type VorlageModus } from '$lib/aufgaben';
	import { stufeName } from '$lib/stufen';

	type VorlageAufgabe = { id: string; titel: string; lautstaerke: number | null; schmutz: number | null };

	/**
	 * „Aus Vorlage übernehmen“ am bestehenden Auftrag (Jamil msg 2975): Vorlage wählen, Vorschau der Aufgaben, bei
	 * gleichnamigen Aufgaben „Nur fehlende hinzufügen“ (Standard) oder „Alle hinzufügen“. Optional für alle neuen
	 * Aufgaben: Mitarbeiter und Tag/Zeitraum (sonst nicht zugewiesen, ohne Datum).
	 */
	let {
		vorlagen,
		vorhandeneTitel,
		mitarbeiter,
		amAuftrag = [],
		aktion = '?/vorlageAnwenden',
		fehler = null,
		onfertig,
		onabbrechen
	}: {
		vorlagen: { id: string; name: string; todos: VorlageAufgabe[] }[];
		vorhandeneTitel: string[];
		mitarbeiter: { id: string; name: string }[];
		amAuftrag?: { id: string; name: string }[];
		aktion?: string;
		fehler?: string | null;
		onfertig?: () => void;
		onabbrechen?: () => void;
	} = $props();

	let vorlageId = $state('');
	let modus = $state<VorlageModus>('fehlende');
	let wer = $state<string[]>([]);
	const vorlage = $derived(vorlagen.find((v) => v.id === vorlageId) ?? null);
	const teile = $derived(vorlage ? vorlageAufteilen(vorlage.todos, vorhandeneTitel, modus) : { neu: [], doppelt: [] });
	const doppeltSchluessel = $derived(new Set(teile.doppelt.map((t) => titelSchluessel(t.titel))));
	const personen = $derived(personenMitVorschlag(mitarbeiter, amAuftrag));
	const belastung = (t: VorlageAufgabe) =>
		[t.lautstaerke ? `Lautstärke ${stufeName(t.lautstaerke)}` : null, t.schmutz ? `Schmutz ${stufeName(t.schmutz)}` : null].filter(Boolean).join(' · ');
</script>

<form
	method="POST"
	action={aktion}
	class="kd-formular va"
	use:enhance={() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			vorlageId = '';
			modus = 'fehlende';
			wer = [];
			onfertig?.();
		}
	}}
>
	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	<label class="va-voll">
		Aufgaben-Vorlage *
		<Auswahl name="vorlageId" bind:value={vorlageId} required aria-label="Aufgaben-Vorlage">
			<option value="">Bitte wählen</option>
			{#each vorlagen as v (v.id)}<option value={v.id}>{v.name} ({v.todos.length})</option>{/each}
		</Auswahl>
	</label>

	{#if vorlage}
		<div class="va-voll va-vorschau" role="group" aria-label="Vorschau der Aufgaben">
			<span class="va-label">Diese Aufgaben kommen zum Auftrag dazu</span>
			<ul class="va-liste">
				{#each vorlage.todos as t (t.id)}
					{@const doppelt = doppeltSchluessel.has(titelSchluessel(t.titel))}
					{@const weg = doppelt && modus === 'fehlende'}
					<li class:weg>
						<span class="va-titel">{t.titel}</span>
						{#if belastung(t)}<span class="va-info">{belastung(t)}</span>{/if}
						{#if doppelt}<span class="va-pill">{weg ? 'schon vorhanden – wird übersprungen' : 'schon vorhanden – kommt doppelt'}</span>{/if}
					</li>
				{/each}
			</ul>
		</div>

		{#if teile.doppelt.length > 0}
			<div class="va-voll ui-feld">
				{teile.doppelt.length === 1 ? 'Eine Aufgabe gibt es' : `${teile.doppelt.length} Aufgaben gibt es`} am Auftrag schon
				<Segmente
					name="modus"
					label="Gleichnamige Aufgaben"
					optionen={[
						{ wert: 'fehlende', text: 'Nur fehlende hinzufügen' },
						{ wert: 'alle', text: 'Alle hinzufügen' }
					]}
					bind:wert={modus}
				/>
			</div>
		{:else}
			<input type="hidden" name="modus" value="fehlende" />
		{/if}

		<div class="va-voll va-meta" role="group" aria-label="Für alle neuen Aufgaben (optional)">
			<span class="va-label">Für alle neuen Aufgaben (optional)</span>
			<input type="hidden" name="mitarbeiterFeld" value="1" />
			<PersonWahl name="mitarbeiterIds" mehrfach label="Mitarbeiter" leerText="Nicht zugewiesen" {personen} bind:werte={wer} />
			<ZeitraumWahl />
		</div>
	{/if}

	<FormFuss>
		<button type="button" class="kd-knopf hell" onclick={() => onabbrechen?.()}>Abbrechen</button>
		<button type="submit" class="kd-knopf" disabled={!vorlage || teile.neu.length === 0}>
			{!vorlage ? 'Übernehmen' : teile.neu.length === 0 ? 'Nichts hinzuzufügen' : `${teile.neu.length} ${teile.neu.length === 1 ? 'Aufgabe' : 'Aufgaben'} hinzufügen`}
		</button>
	</FormFuss>
</form>

<style>
	.va-voll {
		grid-column: 1 / -1;
	}
	.va-label {
		display: block;
		margin-bottom: 0.35rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.va-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.va-liste li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		padding: 0.5rem 0.75rem;
	}
	.va-liste li + li {
		border-top: 1px solid var(--ui-rand);
	}
	.va-liste li.weg .va-titel {
		color: var(--ui-text-leise);
		text-decoration: line-through;
	}
	.va-info {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.va-pill {
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: var(--ui-orange-hell);
		color: var(--ui-orange);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.va-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.va-meta .va-label {
		flex-basis: 100%;
		margin: 0;
	}
</style>
