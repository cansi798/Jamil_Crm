<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { STUFEN, STUFE_NAMEN } from '$lib/stufen';
	import { REGELN, REGEL_NAMEN } from '$lib/wiederholung';

	/** Kleines Formular „+ To-do“ (Titel, Zuständig, Fällig, optional Beschreibung) für Benutzer mit `auftraege.bearbeiten`. */
	let {
		aktion,
		mitarbeiter,
		fehler = null,
		werte = {},
		mitBelastung = false
	}: {
		aktion: string;
		mitarbeiter: { id: string; name: string }[];
		fehler?: string | null;
		werte?: Record<string, string>;
		/** Auftrags-To-dos: Stufen „Lautstärke“ und „Schmutz“ (gering, mittel, hoch; optional). */
		mitBelastung?: boolean;
	} = $props();

	// Wiederholen (Wunsch Jamil, msg 2501): täglich/wöchentlich/monatlich/jährlich, „alle N“, optional bis Datum
	let wiederholen = $state(untrack(() => !!werte.wiederholung));
</script>

<form method="POST" action={aktion} use:enhance class="kd-formular td-neu">
	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	<label>
		Neues To-do
		<input type="text" name="titel" maxlength="200" required placeholder="z. B. Material bestellen" value={werte.titel ?? ''} />
	</label>
	<label class="td-neu-beschreibung">
		Beschreibung (optional)
		<textarea name="beschreibung" maxlength="500" rows="2" placeholder="z. B. Schlüssel beim Nachbarn abholen"
			>{werte.beschreibung ?? ''}</textarea
		>
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
	{#if mitBelastung}
		<div class="td-neu-stufen">
			<label>
				Lautstärke
				<select name="lautstaerke">
					<option value="">–</option>
					{#each STUFEN as n (n)}<option value={String(n)} selected={werte.lautstaerke === String(n)}>{STUFE_NAMEN[n]}</option>{/each}
				</select>
			</label>
			<label>
				Schmutz
				<select name="schmutz">
					<option value="">–</option>
					{#each STUFEN as n (n)}<option value={String(n)} selected={werte.schmutz === String(n)}>{STUFE_NAMEN[n]}</option>{/each}
				</select>
			</label>
		</div>
	{/if}
	<div class="td-neu-wiederholung">
		<label class="kd-haken">
			<input type="checkbox" bind:checked={wiederholen} />
			<span>Wiederkehrend (z. B. Wartung)</span>
		</label>
		{#if wiederholen}
			<div class="td-neu-regel">
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
			</div>
			<p class="kd-info">Erster Termin ist „Fällig“ (sonst heute). Beim Abhaken entsteht automatisch das nächste To-do.</p>
		{/if}
	</div>
	<button type="submit" class="kd-knopf">+ To-do</button>
</form>
