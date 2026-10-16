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
		{#if data.testmodus}
			<p class="testmodus" role="note">
				<strong>Testmodus:</strong> Anmeldung nur mit Benutzername – ohne Passwort und Zwei-Faktor. Gilt nur für
				Test-Zugänge, z. B. <code>can.chef</code>, <code>jamil.buero</code>, <code>can.monteur</code>,
				<code>jamil.admin</code>.
			</p>
			<label>
				Benutzername
				<input type="text" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required
					placeholder="z. B. can.chef" value={form?.email ?? ''} />
			</label>
			<details class="mit-passwort">
				<summary>Mit E-Mail und Passwort anmelden</summary>
				<label>
					Passwort
					<input type="password" name="passwort" autocomplete="current-password" />
				</label>
			</details>
		{:else}
			<label>
				E-Mail
				<input type="email" name="email" autocomplete="username" required value={form?.email ?? ''} />
			</label>
			<label>
				Passwort
				<input type="password" name="passwort" autocomplete="current-password" required />
			</label>
		{/if}
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
	.testmodus {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border: 1px solid #e0b400;
		border-left-width: 4px;
		border-radius: 0.4rem;
		background: #fff8db;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.mit-passwort summary {
		cursor: pointer;
		font-size: 0.9rem;
		color: #5f6368;
	}
	.mit-passwort label {
		margin-top: 0.5rem;
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
