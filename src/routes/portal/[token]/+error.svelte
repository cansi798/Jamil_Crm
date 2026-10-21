<script lang="ts">
	import { page } from '$app/state';

	/** Fehler im Kundenportal (nach dem Passwort), z. B. abgelaufene Sitzung oder unbekanntes Dokument. */
</script>

<main class="pf">
	<h1>{page.status === 404 ? 'Nicht gefunden' : 'Das hat leider nicht geklappt'}</h1>
	<p>{page.error?.message ?? 'Bitte versuchen Sie es später erneut.'}</p>
	<p><a href={`/portal/${page.params.token}`}>Zurück zum Kundenportal</a></p>
</main>

<style>
	.pf {
		max-width: 36rem;
		margin: 3rem auto;
		padding: 0 16px;
		font-family: 'Inter', system-ui, sans-serif;
	}
</style>
