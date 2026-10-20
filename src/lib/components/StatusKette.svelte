<script lang="ts">
	import { enhance } from '$app/forms';
	import { naechsterStatus, STATUS, STATUS_NAMEN, type AuftragStatus } from '$lib/auftrag-status';

	/**
	 * Kompakte Statusleiste eines Auftrags (Wunsch Jamil, msg 2581): eine schmale Zeile mit sechs Stationen, die aktuelle
	 * hervorgehoben, am Ende „Weiter →“. Mit `auftraege.bearbeiten` springt ein Klick auf eine Station dorthin (zurück nur
	 * nach Rückfrage). Am Handy: aktueller Status als Auswahl plus „Weiter →“. Der Server prüft das Recht erneut.
	 */
	let {
		status,
		darfBearbeiten = false,
		aktion = '?/status'
	}: { status: AuftragStatus; darfBearbeiten?: boolean; aktion?: string } = $props();

	const index = $derived(STATUS.indexOf(status));
	const weiter = $derived(naechsterStatus(status));
	const zurueckOk = (ziel: AuftragStatus) =>
		STATUS.indexOf(ziel) > index || confirm(`Status wirklich zurück auf „${STATUS_NAMEN[ziel]}“ setzen?`);
</script>

<div class="sk">
	<form method="POST" action={aktion} use:enhance class="sk-leiste">
		<input type="hidden" name="sprung" value="1" />
		<ol aria-label="Status">
			{#each STATUS as s, i (s)}
				<li class:erledigt={i < index} class:aktuell={s === status}>
					{#if darfBearbeiten && s !== status}
						<button
							type="submit"
							name="status"
							value={s}
							title={`Status auf „${STATUS_NAMEN[s]}“ setzen`}
							onclick={(ev) => {
								if (!zurueckOk(s)) ev.preventDefault();
							}}>{STATUS_NAMEN[s]}</button
						>
					{:else}
						<span aria-current={s === status ? 'step' : undefined}>{STATUS_NAMEN[s]}</span>
					{/if}
				</li>
			{/each}
		</ol>
		{#if darfBearbeiten && weiter}
			<button type="submit" name="status" value={weiter} class="sk-weiter" title={`Weiter zu „${STATUS_NAMEN[weiter]}“`}>Weiter →</button>
		{/if}
	</form>

	<!-- Handy: aktueller Status als Auswahl -->
	<form method="POST" action={aktion} use:enhance class="sk-mobil">
		<input type="hidden" name="sprung" value="1" />
		{#if darfBearbeiten}
			<select
				name="status"
				aria-label="Status"
				class="sk-chip"
				onchange={(ev) => {
					const ziel = ev.currentTarget.value as AuftragStatus;
					if (zurueckOk(ziel)) ev.currentTarget.form?.requestSubmit();
					else ev.currentTarget.value = status;
				}}
			>
				{#each STATUS as s (s)}<option value={s} selected={s === status}>{STATUS_NAMEN[s]}</option>{/each}
			</select>
		{:else}
			<span class="sk-chip">{STATUS_NAMEN[status]}</span>
		{/if}
		<span class="kd-info">Schritt {index + 1} von {STATUS.length}</span>
	</form>
	{#if darfBearbeiten && weiter}
		<form method="POST" action={aktion} use:enhance class="sk-mobil sk-mobil-weiter">
			<input type="hidden" name="sprung" value="1" />
			<button type="submit" name="status" value={weiter} class="sk-weiter">Weiter → {STATUS_NAMEN[weiter]}</button>
		</form>
	{/if}
</div>

<style>
	.sk {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0 1rem;
	}
	.sk-leiste {
		display: flex;
		align-items: stretch;
		gap: 0.5rem;
		width: 100%;
	}
	ol {
		display: flex;
		flex: 1 1 auto;
		margin: 0;
		padding: 0;
		list-style: none;
		min-width: 0;
	}
	li {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
	}
	li > button,
	li > span {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2.5rem;
		padding: 0 0.6rem 0 1.1rem;
		border: 0;
		background: var(--m365-flaeche-hover);
		color: var(--m365-text-leise);
		font: inherit;
		font-size: 0.8125rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* Chevron-Form */
		clip-path: polygon(0 0, calc(100% - 0.6rem) 0, 100% 50%, calc(100% - 0.6rem) 100%, 0 100%, 0.6rem 50%);
		margin-right: -0.3rem;
	}
	li:first-child > button,
	li:first-child > span {
		clip-path: polygon(0 0, calc(100% - 0.6rem) 0, 100% 50%, calc(100% - 0.6rem) 100%, 0 100%);
		border-radius: var(--m365-radius) 0 0 var(--m365-radius);
		padding-left: 0.6rem;
	}
	li > button {
		cursor: pointer;
	}
	li > button:hover {
		background: var(--m365-primaer-hell);
		color: var(--m365-text);
	}
	li.erledigt > button,
	li.erledigt > span {
		background: var(--m365-primaer-hell);
		color: var(--ui-akzent-text);
	}
	li.aktuell > span {
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
		font-weight: 600;
	}
	.sk-weiter {
		flex: 0 0 auto;
		height: 2.5rem;
		padding: 0 0.9rem;
		border: 0;
		border-radius: var(--m365-radius);
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.sk-mobil {
		display: none;
		align-items: center;
		gap: 0.5rem;
	}
	.sk-chip {
		width: auto !important;
		min-height: 2.5rem;
		padding: 0.25rem 0.75rem;
		border-radius: 999px !important;
		border: 1px solid var(--m365-primaer) !important;
		background: var(--m365-primaer-hell) !important;
		color: var(--ui-akzent-text) !important;
		font-weight: 600;
	}
	@media (max-width: 40rem) {
		.sk-leiste {
			display: none;
		}
		.sk-mobil {
			display: flex;
		}
		.sk-mobil-weiter {
			margin-left: auto;
		}
	}
</style>
