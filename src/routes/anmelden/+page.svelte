<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>Anmelden</title>
</svelte:head>

<main>
	<p class="marke">CRM System</p>
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
	<p class="design">Design by Jamil Iqbal</p>
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
	input {
		border: 1px solid #8a8a8a;
		border-radius: 0.4rem;
	}
	button {
		border: 1px solid var(--primaer);
		border-radius: 0.5rem;
		background: var(--primaer);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.marke {
		margin: 0 0 0.25rem;
		color: var(--primaer);
		font-weight: 700;
	}
	.fehler {
		color: #b00020;
		margin: 0;
	}
	.hinweis {
		margin: 0;
	}
	/* Wunsch Can 16.10.2026 */
	.design {
		margin: 2.5rem 0 0;
		text-align: center;
		font-size: 0.85rem;
		color: #5f6368;
		letter-spacing: 0.02em;
	}
</style>
