<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		naechsterStatus,
		STATUS,
		STATUS_NAMEN,
		vorigerStatus,
		type AuftragStatus
	} from '$lib/auftrag-status';

	/**
	 * Statuskette eines Auftrags: sechs Stationen, die aktuelle hervorgehoben. Mit Recht `auftraege.bearbeiten`
	 * darunter „← Zurück“ und „Weiter →“ (ein Schritt; die Seite prüft serverseitig noch einmal).
	 */
	let {
		status,
		darfBearbeiten = false,
		aktion = '?/status'
	}: { status: AuftragStatus; darfBearbeiten?: boolean; aktion?: string } = $props();

	const index = $derived(STATUS.indexOf(status));
	const zurueck = $derived(vorigerStatus(status));
	const weiter = $derived(naechsterStatus(status));
</script>

<ol class="af-kette" aria-label="Statuskette">
	{#each STATUS as s, i (s)}
		<li class:erledigt={i < index} aria-current={s === status ? 'step' : undefined}>{STATUS_NAMEN[s]}</li>
	{/each}
</ol>

{#if darfBearbeiten && (zurueck || weiter)}
	<div class="af-schritte">
		<form method="POST" action={aktion} use:enhance>
			{#if zurueck}
				<button type="submit" name="status" value={zurueck} class="kd-knopf hell">
					← Zurück <small>{STATUS_NAMEN[zurueck]}</small>
				</button>
			{/if}
			{#if weiter}
				<button type="submit" name="status" value={weiter} class="kd-knopf">
					Weiter → <small>{STATUS_NAMEN[weiter]}</small>
				</button>
			{/if}
		</form>
	</div>
{/if}
