<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Bestätigungscode</title>
</svelte:head>

<main>
	<h1>Bestätigungscode</h1>
	<p>Bitte den 6-stelligen Code aus Ihrer Authenticator-App eingeben.</p>
	<form method="POST" use:enhance>
		{#if form?.fehler}
			<p role="alert" class="fehler">
				{form.fehler}
				{#if form.verbleibend}Noch {form.verbleibend} {form.verbleibend === 1 ? 'Versuch' : 'Versuche'}.{/if}
			</p>
		{/if}
		<label>
			Code
			<input
				type="text"
				name="code"
				inputmode="numeric"
				autocomplete="one-time-code"
				pattern="[0-9 ]*"
				maxlength="12"
				required
			/>
		</label>
		<button type="submit" class="kd-knopf">Bestätigen</button>
	</form>
	<p><a href="/anmelden">Zurück zur Anmeldung</a></p>
</main>

<style>
	main {
		max-width: 22rem;
		margin: 4rem auto;
		padding: 0 1rem;
	}
	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	input,
	button {
		font: inherit;
		padding: 0.5rem;
		min-height: 2.75rem;
	}
	.fehler {
		color: #b00020;
		margin: 0;
	}
</style>
