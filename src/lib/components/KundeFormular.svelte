<script lang="ts">
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import { enhance } from '$app/forms';

	/** Formular für Kunden (Neu und Bearbeiten). Die Seite liefert Werte und Fehler aus `load` bzw. der Aktion. */
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

	let gewaehlt = $state<string | null>(null);
	const art = $derived(gewaehlt ?? (werte.art === 'firma' ? 'firma' : 'privat'));
</script>

<form method="POST" action={aktion} use:enhance class="kd-formular">
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{/if}

	<fieldset>
		<legend>Art des Kunden</legend>
		<Segmente
			name="art"
			label="Art des Kunden"
			wert={art}
			optionen={[
				{ wert: 'privat', text: 'Privatkunde' },
				{ wert: 'firma', text: 'Firma' }
			]}
			onchange={(w) => (gewaehlt = w as typeof gewaehlt)}
		/>
	</fieldset>

	{#if art === 'firma'}
		<label>
			Firmenname *
			<input type="text" name="firma" maxlength="200" required value={werte.firma ?? ''} autocomplete="organization" />
		</label>
	{/if}

	<label>
		{art === 'firma' ? 'Anrede Ansprechpartner' : 'Anrede'}
		<input type="text" name="anrede" maxlength="50" list="anreden" value={werte.anrede ?? ''} />
		<datalist id="anreden">
			<option value="Herr"></option>
			<option value="Frau"></option>
			<option value="Familie"></option>
		</datalist>
	</label>
	<div class="kd-zwei">
		<label>
			Vorname
			<input type="text" name="vorname" maxlength="200" value={werte.vorname ?? ''} autocomplete="given-name" />
		</label>
		<label>
			{art === 'privat' ? 'Nachname *' : 'Nachname'}
			<input type="text" name="nachname" maxlength="200" required={art === 'privat'} value={werte.nachname ?? ''} autocomplete="family-name" />
		</label>
	</div>

	<label>
		Telefon
		<input type="tel" name="telefon" maxlength="50" value={werte.telefon ?? ''} autocomplete="tel" />
	</label>
	<label>
		E-Mail
		<input type="email" name="email" maxlength="200" value={werte.email ?? ''} autocomplete="email" />
	</label>

	<label>
		Straße und Hausnummer
		<input type="text" name="strasse" maxlength="200" value={werte.strasse ?? ''} autocomplete="street-address" />
	</label>
	<div class="kd-zwei">
		<label>
			PLZ
			<input type="text" name="plz" maxlength="20" value={werte.plz ?? ''} autocomplete="postal-code" />
		</label>
		<label>
			Ort
			<input type="text" name="ort" maxlength="200" value={werte.ort ?? ''} autocomplete="address-level2" />
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
