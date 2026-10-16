<script lang="ts">
	import { enhance } from '$app/forms';
	import { EINHEITEN, GEWERKE, GEWERK_NAMEN } from '$lib/katalog-werte';

	/** Formular für eine Katalogposition (Neu und Bearbeiten). Preisfelder nur mit `mitPreisen`. Beträge in Euro. */
	let {
		aktion,
		werte,
		fehler = null,
		mitPreisen,
		mitAktiv = false,
		knopf,
		abbrechen
	}: {
		aktion: string;
		werte: Record<string, string>;
		fehler?: string | null;
		mitPreisen: boolean;
		mitAktiv?: boolean;
		knopf: string;
		abbrechen: string;
	} = $props();
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
			<select name="einheit" required>
				{#each EINHEITEN as e (e)}
					<option value={e} selected={(werte.einheit || 'Stk') === e}>{e}</option>
				{/each}
			</select>
		</label>
		<label>
			Gewerk
			<select name="gewerk">
				<option value="" selected={!werte.gewerk}>–</option>
				{#each GEWERKE as g (g)}
					<option value={g} selected={werte.gewerk === g}>{GEWERK_NAMEN[g]}</option>
				{/each}
			</select>
		</label>
	</div>
	<label>
		Nummer (optional)
		<input type="text" name="nummer" maxlength="20" value={werte.nummer ?? ''} />
	</label>
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
		<button type="submit" class="kd-knopf">{knopf}</button>
		<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
	</div>
</form>
