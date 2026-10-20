<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { ANLAGEN_TYPEN, EXTRA_FELDER, TYP_NAMEN, istAnlagenTyp, type AnlagenTyp } from '$lib/anlagen-typen';
	import { REGELN, REGEL_NAMEN } from '$lib/wiederholung';

	/**
	 * Anlage anlegen/bearbeiten (Wünsche Jamil, msgs 2503/2505). Die Zusatzfelder (`extra_<feld>`) wechseln mit dem Typ;
	 * geprüft wird auf dem Server (src/lib/anlagen-typen.ts).
	 */
	let {
		aktion,
		werte = {},
		fehler = null,
		knopf = 'Speichern'
	}: { aktion: string; werte?: Record<string, string>; fehler?: string | null; knopf?: string } = $props();

	let typ = $state<AnlagenTyp>(untrack(() => (istAnlagenTyp(werte.typ) ? werte.typ : 'waermepumpe')));
	let wartung = $state(untrack(() => werte.wartungRegel ?? ''));
	const felder = $derived(EXTRA_FELDER[typ]);
</script>

<form method="POST" action={aktion} use:enhance={() => async ({ update }) => update({ reset: false })} class="kd-formular an-formular">
	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	<div class="kd-zwei an-zwei">
		<label>
			Typ *
			<Auswahl name="typ" bind:value={typ}>
				{#each ANLAGEN_TYPEN as t (t)}<option value={t}>{TYP_NAMEN[t]}</option>{/each}
			</Auswahl>
		</label>
		<label>
			Bezeichnung
			<input type="text" name="bezeichnung" maxlength="200" value={werte.bezeichnung ?? ''} placeholder={`z. B. ${TYP_NAMEN[typ]} Keller`} />
		</label>
	</div>
	<div class="kd-zwei an-zwei">
		<label>Hersteller <input type="text" name="hersteller" maxlength="200" value={werte.hersteller ?? ''} /></label>
		<label>Modell <input type="text" name="modell" maxlength="200" value={werte.modell ?? ''} /></label>
	</div>
	<div class="kd-zwei an-zwei">
		<label>Seriennummer <input type="text" name="seriennummer" maxlength="100" value={werte.seriennummer ?? ''} /></label>
		<label>Standort im Objekt <input type="text" name="standort" maxlength="200" value={werte.standort ?? ''} placeholder="z. B. Keller, Hauswirtschaftsraum" /></label>
	</div>
	<div class="an-drei">
		<label>Baujahr <input type="number" name="baujahr" min="1900" max="2100" inputmode="numeric" value={werte.baujahr ?? ''} /></label>
		<label>Einbaudatum <input type="date" name="einbaudatum" value={werte.einbaudatum ?? ''} /></label>
		<label>Garantie bis <input type="date" name="garantieBis" value={werte.garantieBis ?? ''} /></label>
	</div>

	{#if felder.length > 0}
		<fieldset>
			<legend>Angaben zur Anlage ({TYP_NAMEN[typ]})</legend>
			<div class="an-drei">
				{#each felder as f (typ + f.key)}
					<label>
						{f.name}{#if f.art === 'zahl' && f.einheit}&nbsp;({f.einheit}){/if}
						{#if f.art === 'auswahl'}
							<Auswahl name={`extra_${f.key}`}>
								<option value="">–</option>
								{#each f.optionen as [wert, text] (wert)}
									<option value={wert} selected={werte[`extra_${f.key}`] === wert}>{text}</option>
								{/each}
							</Auswahl>
						{:else if f.art === 'datum'}
							<input type="date" name={`extra_${f.key}`} value={werte[`extra_${f.key}`] ?? ''} />
						{:else if f.art === 'zahl'}
							<input type="text" inputmode="decimal" name={`extra_${f.key}`} value={werte[`extra_${f.key}`] ?? ''} />
						{:else}
							<input type="text" name={`extra_${f.key}`} maxlength={f.max ?? 200} value={werte[`extra_${f.key}`] ?? ''} />
						{/if}
					</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	<fieldset>
		<legend>Wartung</legend>
		<div class="an-drei">
			<label>
				Wartungsintervall
				<Auswahl name="wartungRegel" bind:value={wartung}>
					<option value="">keine</option>
					{#each REGELN as r (r)}<option value={r}>{REGEL_NAMEN[r]}</option>{/each}
				</Auswahl>
			</label>
			{#if wartung}
				<label>
					alle …
					<input type="number" name="wartungIntervall" min="1" max="365" value={werte.wartungIntervall || '1'} />
				</label>
			{/if}
		</div>
		<p class="kd-info">Mit „Wartung planen“ auf der Anlage entsteht daraus ein wiederkehrendes To-do.</p>
	</fieldset>

	<label>
		Notiz
		<textarea name="notiz" maxlength="2000" rows="3">{werte.notiz ?? ''}</textarea>
	</label>
	<div class="kd-aktionen">
		<button type="submit" class="kd-knopf">{knopf}</button>
	</div>
</form>

<style>
	.an-drei {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
	}
	@media (min-width: 40rem) {
		.an-zwei {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
