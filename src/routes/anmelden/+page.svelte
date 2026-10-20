<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { loesche } from '$lib/heute-kopie';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	// Wer hier landet, ist nicht (mehr) angemeldet: Offline-Kopie der Einsätze vom Gerät entfernen
	onMount(() => loesche());
</script>

<svelte:head>
	<title>Anmelden</title>
</svelte:head>

<main>
	<div class="anmelde-karte">
		<div class="kopf">
			<span class="logo"></span>
			<span class="marke">CRM System</span>
		</div>
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
				<label class="feld">
					Benutzername
					<input type="text" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required
						placeholder="z. B. can.chef" value={form?.email ?? ''} />
				</label>
				<details class="mit-passwort">
					<summary>Mit E-Mail und Passwort anmelden</summary>
					<label class="feld">
						Passwort
						<input type="password" name="passwort" autocomplete="current-password" />
					</label>
				</details>
			{:else}
				<label class="feld">
					E-Mail
					<input type="email" name="email" autocomplete="username" required value={form?.email ?? ''} />
				</label>
				<label class="feld">
					Passwort
					<input type="password" name="passwort" autocomplete="current-password" required />
				</label>
			{/if}
			<button type="submit" class="anmelde-knopf">Anmelden</button>
		</form>
		{#if data.nextcloud}
			<div class="oder" aria-hidden="true"><span>oder</span></div>
			<a class="nextcloud-knopf" href="/anmelden/nextcloud" data-sveltekit-reload>Mit Nextcloud anmelden</a>
		{/if}
		<p class="design">Design by Jamil Iqbal</p>
	</div>
</main>

<style>
	/* M365-Anmeldehintergrund */
	main {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 2rem 1rem;
		background: var(--m365-hintergrund);
	}

	/* Zentrierte Anmeldekarte (wie M365-Sign-In) */
	.anmelde-karte {
		width: 100%;
		max-width: 24rem;
		padding: 2.5rem 2rem;
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten-hoch);
	}

	.kopf {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		margin-bottom: 1.5rem;
	}

	.logo {
		display: inline-block;
		width: 2rem;
		height: 2rem;
		border-radius: var(--m365-radius);
		background: var(--m365-primaer);
		flex-shrink: 0;
	}

	.marke {
		color: var(--m365-text);
		font-family: var(--m365-schrift);
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--m365-text);
	}

	form {
		display: grid;
		gap: 1rem;
	}

	.feld {
		display: grid;
		gap: 0.25rem;
	}

	.feld input {
		font: inherit;
		padding: 0.5rem 0.75rem;
		min-height: var(--tippziel);
		border: 1px solid var(--m365-rand-stark);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
	}
	.feld input:focus {
		border-color: var(--m365-primaer);
		box-shadow: 0 0 0 2px rgba(0,120,212,0.2);
		outline: none;
	}

	.anmelde-knopf {
		font: inherit;
		padding: 0.375rem 1rem;
		min-height: var(--tippziel);
		margin-top: 0.5rem;
		border: 1px solid var(--m365-primaer);
		border-radius: var(--m365-radius);
		background: var(--m365-primaer);
		color: #fff;
		font-family: var(--m365-schrift);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 150ms;
	}
	.anmelde-knopf:hover {
		background: var(--m365-primaer-hover);
		border-color: var(--m365-primaer-hover);
	}

	.fehler {
		color: var(--m365-fehler);
		margin: 0;
		font-size: 0.875rem;
	}
	.hinweis {
		margin: 0;
		font-size: 0.875rem;
	}

	.testmodus {
		margin: 0;
		padding: 0.75rem 0.9rem;
		border: none;
		border-left: 4px solid var(--m365-warnung);
		border-radius: var(--m365-radius);
		background: var(--m365-warnung-hell);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--m365-text);
	}

	.mit-passwort summary {
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--m365-primaer);
		font-weight: 600;
	}
	.mit-passwort label {
		margin-top: 0.5rem;
	}

	/* „Mit Nextcloud anmelden“ (optional) */
	.oder {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1.25rem 0 1rem;
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.oder::before,
	.oder::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--m365-rand, #d1d1d1);
	}
	.nextcloud-knopf {
		display: block;
		text-align: center;
		padding: 0.65rem 1rem;
		border: 1px solid var(--m365-primaer);
		border-radius: var(--m365-radius);
		color: var(--m365-primaer);
		font-weight: 600;
		text-decoration: none;
	}
	.nextcloud-knopf:hover,
	.nextcloud-knopf:focus-visible {
		background: var(--m365-primaer);
		color: #fff;
	}

	/* Wunsch Can 16.10.2026 */
	.design {
		margin: 2rem 0 0;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
		letter-spacing: 0.02em;
	}
</style>
