<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Rollen</title>
</svelte:head>

<main>
	<h1>Rollen</h1>
	<p>Eine Rolle legt fest, was ein Benutzer im System sehen und tun darf.</p>

	<ul class="liste">
		{#each data.rollen as rolle (rolle.id)}
			<li>
				<a href={`/einstellungen/rollen/${rolle.id}`}>
					<strong>{rolle.name}</strong>
					<span class="info">
						{rolle.rechte.length} {rolle.rechte.length === 1 ? 'Recht' : 'Rechte'} ·
						{rolle.benutzer} Benutzer
					</span>
				</a>
			</li>
		{:else}
			<li class="leer">Noch keine Rollen vorhanden.</li>
		{/each}
	</ul>

	<h2>Neue Rolle</h2>
	<form method="POST" action="?/neu" use:enhance>
		{#if form?.fehler}
			<p role="alert" class="fehler">{form.fehler}</p>
		{/if}
		<label>
			Name
			<input type="text" name="name" maxlength="60" required value={form?.name ?? ''} />
		</label>
		<label>
			Vorlage
			<select name="vorlage">
				<option value="">Leer (ohne Rechte)</option>
				{#each data.vorlagen as vorlage (vorlage.schluessel)}
					<option value={vorlage.schluessel}>{vorlage.name}</option>
				{/each}
			</select>
		</label>
		<button type="submit">Rolle anlegen</button>
	</form>
</main>

<style>
	main {
		max-width: 36rem;
		margin: 1.5rem auto;
		padding: 0 1rem;
	}
	.liste {
		list-style: none;
		margin: 1rem 0 2rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.liste a {
		display: grid;
		gap: 0.15rem;
		min-height: 2.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid #c8c8c8;
		border-radius: 0.4rem;
		color: inherit;
		text-decoration: none;
	}
	.info {
		font-size: 0.9rem;
		color: #555;
	}
	.leer {
		color: #555;
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
	select,
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
