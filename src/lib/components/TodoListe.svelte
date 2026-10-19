<script lang="ts">
	import { enhance } from '$app/forms';
	import { tagDeutsch } from '$lib/zeit';

	type Todo = {
		id: string;
		titel: string;
		auftragId: string | null;
		auftragNummer: string | null;
		auftragTitel: string | null;
		zustaendigId: string | null;
		zustaendigName: string | null;
		faellig: string | null;
		erledigt: boolean;
	};

	/**
	 * To-do-Liste mit großen Abhakflächen (≥ 44 px). Abhaken darf, wer bearbeiten darf, oder der Zuständige selbst;
	 * Bearbeiten/Löschen nur mit `auftraege.bearbeiten`. Überfällig (rot): offen und vor `heute` (Berlin) fällig.
	 * `aktionen`: Namen der Formular-Aktionen der Seite (z. B. `?/umschalten` bzw. `?/todoUmschalten`).
	 */
	let {
		todos,
		heute,
		benutzerId,
		darfBearbeiten = false,
		mitarbeiter = [],
		zeigeAuftrag = true,
		aktionen,
		leer = 'Keine To-dos.'
	}: {
		todos: Todo[];
		heute: string;
		benutzerId: string;
		darfBearbeiten?: boolean;
		mitarbeiter?: { id: string; name: string }[];
		zeigeAuftrag?: boolean;
		aktionen: { umschalten: string; aendern: string; loeschen: string };
		leer?: string;
	} = $props();

	const ueberfaellig = (t: Todo) => !t.erledigt && t.faellig !== null && t.faellig < heute;
</script>

<ul class="td-liste">
	{#each todos as t (t.id)}
		{@const darfHaken = darfBearbeiten || t.zustaendigId === benutzerId}
		<li class="td-eintrag" class:erledigt={t.erledigt} class:ueberfaellig={ueberfaellig(t)}>
			<form method="POST" action={aktionen.umschalten} use:enhance>
				<input type="hidden" name="id" value={t.id} />
				<input type="hidden" name="erledigt" value={t.erledigt ? 'false' : 'true'} />
				<button
					type="submit"
					class="td-haken"
					aria-pressed={t.erledigt}
					disabled={!darfHaken}
					aria-label={t.erledigt ? `„${t.titel}“ wieder öffnen` : `„${t.titel}“ als erledigt abhaken`}
					title={darfHaken ? undefined : 'Nur der Zuständige kann abhaken'}
				>
					{t.erledigt ? '✓' : ''}
				</button>
			</form>
			<div>
				<span class="td-titel">{t.titel}</span>
				<span class="td-info">
					{#if t.faellig}
						<span class:td-ueberfaellig={ueberfaellig(t)}>
							{ueberfaellig(t) ? 'Überfällig seit' : 'Fällig'}
							{tagDeutsch(t.faellig)}
						</span>
					{/if}
					<span>{t.zustaendigName ?? 'Niemand zugewiesen'}</span>
					{#if zeigeAuftrag && t.auftragId}
						<a href={`/auftraege/${t.auftragId}`}>{t.auftragNummer} {t.auftragTitel}</a>
					{/if}
				</span>
				{#if darfBearbeiten}
					<details class="td-bearbeiten">
						<summary>Bearbeiten</summary>
						<form method="POST" action={aktionen.aendern} use:enhance class="kd-formular">
							<input type="hidden" name="id" value={t.id} />
							<label>Titel <input type="text" name="titel" maxlength="200" required value={t.titel} /></label>
							<label>
								Zuständig
								<select name="zustaendigId">
									<option value="" selected={t.zustaendigId === null}>– niemand –</option>
									{#each mitarbeiter as m (m.id)}
										<option value={m.id} selected={m.id === t.zustaendigId}>{m.name}</option>
									{/each}
									{#if t.zustaendigId && !mitarbeiter.some((m) => m.id === t.zustaendigId)}
										<!-- deaktivierter Zuständiger: bleibt beim Speichern erhalten, statt still zu verschwinden -->
										<option value={t.zustaendigId} selected>{t.zustaendigName ?? 'Ehemalig'} (deaktiviert)</option>
									{/if}
								</select>
							</label>
							<label>Fällig <input type="date" name="faellig" value={t.faellig ?? ''} /></label>
							<button type="submit" class="kd-knopf">Speichern</button>
						</form>
						<form method="POST" action={aktionen.loeschen} use:enhance>
							<input type="hidden" name="id" value={t.id} />
							<button type="submit" class="kd-knopf gefahr td-loeschen">To-do löschen</button>
						</form>
					</details>
				{/if}
			</div>
		</li>
	{:else}
		<li class="kd-leer">{leer}</li>
	{/each}
</ul>
