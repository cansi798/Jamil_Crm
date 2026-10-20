<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { EINHEITEN, GEWERKE, GEWERK_NAMEN } from '$lib/katalog-werte';
	import { euro } from '$lib/geld';
	import { lohnAusMinuten, minutenJeEinheit, type Firmensatz } from '$lib/kalkulation';

	/** Formular für eine Katalogposition (Neu und Bearbeiten). Preisfelder nur mit `mitPreisen`. Beträge in Euro. */
	let {
		aktion,
		werte,
		fehler = null,
		mitPreisen,
		mitAktiv = false,
		satz = null,
		knopf,
		abbrechen
	}: {
		aktion: string;
		werte: Record<string, string>;
		fehler?: string | null;
		mitPreisen: boolean;
		mitAktiv?: boolean;
		/** Stundensätze aus der Kalkulation (nur wer sie sehen darf) – für den Lohn-Vorschlag aus der Arbeitszeit. */
		satz?: Firmensatz | null;
		knopf: string;
		abbrechen: string;
	} = $props();

	// Arbeitszeit je Einheit (Wunsch Jamil, msg 2476): Lohn-Vorschlag = Minuten × Stundensatz
	let minutenText = $state(untrack(() => werte.arbeitMinuten ?? ''));
	let einheit = $state(untrack(() => werte.einheit || 'Stk'));
	const minuten = $derived.by(() => {
		const t = minutenText.trim().replace(',', '.');
		return minutenJeEinheit(einheit, t === '' || Number.isNaN(Number(t)) ? null : Number(t));
	});
</script>

<form method="POST" action={aktion} use:enhance class="kd-formular">
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{/if}
	<label>
		Bezeichnung *
		<input type="text" name="bezeichnung" maxlength="200" required value={werte.bezeichnung ?? ''} />
	</label>
	<div class="kd-zwei">
		<label>
			Einheit *
			<Auswahl name="einheit" required bind:value={einheit}>
				{#each EINHEITEN as e (e)}
					<option value={e} selected={(werte.einheit || 'Stk') === e}>{e}</option>
				{/each}
			</Auswahl>
		</label>
		<label>
			Gewerk
			<Auswahl name="gewerk">
				<option value="" selected={!werte.gewerk}>–</option>
				{#each GEWERKE as g (g)}
					<option value={g} selected={werte.gewerk === g}>{GEWERK_NAMEN[g]}</option>
				{/each}
			</Auswahl>
		</label>
	</div>
	<label>
		Nummer (optional)
		<input type="text" name="nummer" maxlength="20" value={werte.nummer ?? ''} />
	</label>
	<label>
		Arbeitszeit je Einheit (Minuten, optional)
		<input type="text" name="arbeitMinuten" inputmode="decimal" bind:value={minutenText} placeholder={einheit === 'h' ? '60 (bei „h“ automatisch)' : 'z. B. 45'} />
		<span class="kd-info">Für Ampel und Gewinn im Angebot – keine Zeiterfassung nötig.</span>
	</label>
	{#if mitPreisen && satz && minuten !== null}
		<p class="kt-hinweis" role="note">
			Lohn-Vorschlag für {String(minuten).replace('.', ',')} Min.: {euro(lohnAusMinuten(minuten, satz.empfohlenCent))} (Verrechnungssatz {euro(
				satz.empfohlenCent
			)}/h) · kostendeckend ab {euro(lohnAusMinuten(minuten, satz.kostendeckendCent))}
		</p>
	{/if}
	{#if mitPreisen}
		<div class="kd-zwei">
			<label>
				Lohn je Einheit (€)
				<input type="text" name="lohn" inputmode="decimal" value={werte.lohn ?? ''} placeholder="0,00" />
			</label>
			<label>
				Material je Einheit (€)
				<input type="text" name="material" inputmode="decimal" value={werte.material ?? ''} placeholder="0,00" />
			</label>
		</div>
	{/if}
	<label>
		Beschreibung
		<textarea name="beschreibung" maxlength="2000" rows="4">{werte.beschreibung ?? ''}</textarea>
	</label>
	{#if mitAktiv}
		<label class="kt-checkbox">
			<input type="checkbox" name="aktiv" checked={werte.aktiv !== 'false'} />
			Aktiv (in Angeboten auswählbar)
		</label>
	{/if}
	<div class="kd-aktionen">
		<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
		<button type="submit" class="kd-knopf">{knopf}</button>
	</div>
</form>
