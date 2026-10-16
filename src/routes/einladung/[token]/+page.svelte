<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ungueltig = $derived(!data.gueltig || form?.ungueltig === true);
</script>

<svelte:head>
	<title>Einladung</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main>
	{#if ungueltig}
		<h1>Einladung</h1>
		<p role="alert" class="fehler">Diese Einladung ist nicht mehr gültig.</p>
		<p>Bitten Sie die Person, die Sie eingeladen hat, um einen neuen Link.</p>
	{:else if data.gueltig}
		<h1>Willkommen!</h1>
		<p>Sie wurden zu <strong>{data.betrieb}</strong> eingeladen. Legen Sie Ihren Namen und ein Passwort fest.</p>

		<form method="POST" use:enhance>
			{#if form?.fehler}
				<p role="alert" class="fehler">{form.fehler}</p>
			{/if}
			<label>
				E-Mail
				<input type="email" value={data.email} readonly autocomplete="username" />
			</label>
			<label>
				Ihr Name
				<input type="text" name="name" maxlength="100" required autocomplete="name" value={form?.name ?? ''} />
			</label>
			<label>
				Passwort
				<input type="password" name="passwort" minlength="10" required autocomplete="new-password" />
				<span class="hinweis">Mindestens 10 Zeichen.</span>
			</label>
			<label>
				Passwort wiederholen
				<input type="password" name="passwort2" minlength="10" required autocomplete="new-password" />
			</label>
			<button type="submit">Konto einrichten</button>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: 28rem;
		margin: 1.5rem auto;
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
	input[readonly] {
		background: #f2f2f2;
		color: #444;
	}
	.hinweis {
		font-size: 0.9rem;
		color: #555;
	}
	.fehler {
		color: #b00020;
		margin: 0;
	}
</style>
