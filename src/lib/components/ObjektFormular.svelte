<script lang="ts">
	import { enhance } from '$app/forms';

	/** Formular für Objekte (Baustelle / Einsatzort eines Kunden). */
	let {
		aktion,
		werte,
		fehler = null,
		knopf,
		abbrechen
	}: {
		aktion: string;
		werte: Record<string, string>;
		fehler?: string | null;
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
		<input type="text" name="bezeichnung" maxlength="200" required value={werte.bezeichnung ?? ''} placeholder="z. B. Einfamilienhaus Gartenstraße" />
	</label>
	<label>
		Straße und Hausnummer
		<input type="text" name="strasse" maxlength="200" value={werte.strasse ?? ''} />
	</label>
	<div class="kd-zwei">
		<label>
			PLZ
			<input type="text" name="plz" maxlength="20" value={werte.plz ?? ''} />
		</label>
		<label>
			Ort
			<input type="text" name="ort" maxlength="200" value={werte.ort ?? ''} />
		</label>
	</div>
	<label>
		Notiz
		<textarea name="notiz" maxlength="2000" rows="4">{werte.notiz ?? ''}</textarea>
	</label>

	<div class="kd-aktionen">
		<a href={abbrechen} class="kd-knopf hell">Abbrechen</a>
		<button type="submit" class="kd-knopf">{knopf}</button>
	</div>
</form>
