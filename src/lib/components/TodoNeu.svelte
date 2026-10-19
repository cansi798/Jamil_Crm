<script lang="ts">
	import { enhance } from '$app/forms';

	/** Kleines Formular „+ To-do“ (Titel, Zuständig, Fällig) für Benutzer mit `auftraege.bearbeiten`. */
	let {
		aktion,
		mitarbeiter,
		fehler = null,
		werte = {}
	}: {
		aktion: string;
		mitarbeiter: { id: string; name: string }[];
		fehler?: string | null;
		werte?: Record<string, string>;
	} = $props();
</script>

<form method="POST" action={aktion} use:enhance class="kd-formular td-neu">
	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	<label>
		Neues To-do
		<input type="text" name="titel" maxlength="200" required placeholder="z. B. Material bestellen" value={werte.titel ?? ''} />
	</label>
	<label>
		Zuständig
		<select name="zustaendigId">
			<option value="">– niemand –</option>
			{#each mitarbeiter as m (m.id)}
				<option value={m.id} selected={m.id === werte.zustaendigId}>{m.name}</option>
			{/each}
		</select>
	</label>
	<label>
		Fällig
		<input type="date" name="faellig" value={werte.faellig ?? ''} />
	</label>
	<button type="submit" class="kd-knopf">+ To-do</button>
</form>
