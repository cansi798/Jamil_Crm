<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Zwei-Faktor-Anmeldung einrichten</title>
</svelte:head>

<main>
	<h1>Zwei-Faktor-Anmeldung einrichten</h1>
	<p>
		Für Ihr Konto ist ein zweiter Faktor Pflicht. Richten Sie jetzt eine Authenticator-App ein
		(z. B. Google Authenticator, Microsoft Authenticator oder Aegis).
	</p>
	<ol>
		<li>Scannen Sie den QR-Code mit der App.</li>
		<li>Geben Sie unten den 6-stelligen Code ein, den die App anzeigt.</li>
	</ol>
	<img src={data.qr} alt="QR-Code für die Authenticator-App" width="240" height="240" />
	<p>
		Kein Scan möglich? Geben Sie dieses Geheimnis in der App von Hand ein
		(Konto: {data.email}, Zeitbasiert):
	</p>
	<p><code class="geheimnis">{data.geheimnis}</code></p>
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
		<button type="submit">Einrichten und anmelden</button>
	</form>
</main>

<style>
	main {
		max-width: 28rem;
		margin: 3rem auto;
		padding: 0 1rem;
	}
	img {
		display: block;
		max-width: 100%;
		height: auto;
	}
	.geheimnis {
		font-size: 1.1rem;
		letter-spacing: 0.05em;
		word-break: break-all;
	}
	form {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
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
