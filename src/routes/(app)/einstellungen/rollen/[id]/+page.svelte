<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Rolle {data.rolle.name}</title>
</svelte:head>

<main>
	<p><a href="/einstellungen/rollen" class="zurueck">← Alle Rollen</a></p>
	<h1>Rolle bearbeiten</h1>

	<form method="POST" action="?/speichern" use:enhance>
		{#if form?.fehler}
			<p role="alert" class="fehler">{form.fehler}</p>
		{:else if form?.gespeichert}
			<p role="status" class="erfolg">Gespeichert.</p>
		{/if}
		<label>
			Name
			<input type="text" name="name" maxlength="60" required value={data.rolle.name} />
		</label>
		<fieldset>
			<legend>Rechte</legend>
			{#each data.rechte as recht (recht.schluessel)}
				<label class="recht">
					<input
						type="checkbox"
						name="rechte"
						value={recht.schluessel}
						checked={data.rolle.rechte.includes(recht.schluessel)}
					/>
					<span>{recht.label}</span>
				</label>
			{/each}
		</fieldset>
		<p class="hinweis">
			Wer „Einstellungen verwalten“ hat, muss sich künftig mit einem zweiten Faktor anmelden und wird dafür
			einmal abgemeldet.
		</p>
		<button type="submit" class="kd-knopf">Speichern</button>
	</form>

	<form method="POST" action="?/loeschen" use:enhance class="loeschen">
		<button type="submit" class="kd-knopf gefahr">Rolle löschen</button>
	</form>
</main>

<style>
	main {
		max-width: 36rem;
		margin: 1.5rem auto;
		padding: 0 1rem;
	}
	.zurueck {
		display: inline-block;
		min-height: 2.75rem;
		line-height: 2.75rem;
	}
	form {
		display: grid;
		gap: 1rem;
	}
	.loeschen {
		margin-top: 2rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	fieldset {
		border: 1px solid #c8c8c8;
		border-radius: 0.4rem;
		padding: 0.5rem 0.75rem;
		display: grid;
		gap: 0;
	}
	.recht {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 2.75rem;
	}
	.recht input {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
	}
	input[type='text'],
	button {
		font: inherit;
		padding: 0.5rem;
		min-height: 2.75rem;
	}
	.fehler {
		color: #b00020;
		margin: 0;
	}
	.erfolg {
		color: #1b6e2d;
		margin: 0;
	}
	.hinweis {
		font-size: 0.9rem;
		color: #555;
		margin: 0;
	}
	.gefahr {
		color: #b00020;
	}
</style>
