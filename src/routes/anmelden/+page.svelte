<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>Anmelden</title>
</svelte:head>

<main>
	<h1>Anmelden</h1>
	<form method="POST" use:enhance>
		{#if form?.fehler}
			<p role="alert" class="fehler">{form.fehler}</p>
		{:else if data.hinweis}
			<p role="status" class="hinweis">{data.hinweis}</p>
		{/if}
		<label>
			E-Mail
			<input type="email" name="email" autocomplete="username" required value={form?.email ?? ''} />
		</label>
		<label>
			Passwort
			<input type="password" name="passwort" autocomplete="current-password" required />
		</label>
		<button type="submit">Anmelden</button>
	</form>
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
	.hinweis {
		margin: 0;
	}
</style>
