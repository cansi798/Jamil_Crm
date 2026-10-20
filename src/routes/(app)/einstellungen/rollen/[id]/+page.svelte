<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Rolle {data.rolle.name}</title>
</svelte:head>

<main class="kd-seite">
	<SeitenKopf titel="Rolle bearbeiten" meta={data.rolle.name} zurueck={{ href: '/einstellungen/rollen', text: 'Alle Rollen' }} />

	<form method="POST" action="?/speichern" use:enhance class="kd-formular">
		{#if form?.fehler}
			<p role="alert" class="kd-fehler">{form.fehler}</p>
		{:else if form?.gespeichert}
			<p role="status" class="kd-info">Gespeichert.</p>
		{/if}
		<label>
			Name
			<input type="text" name="name" maxlength="60" required value={data.rolle.name} />
		</label>
		<Abschnitt titel="Rechte" anzahl={data.rechte.length}>
			<fieldset class="rl-rechte">
				<legend class="unsichtbar">Rechte</legend>
				{#each data.rechte as recht (recht.schluessel)}
					<label class="kd-haken rl-recht">
						<input type="checkbox" name="rechte" value={recht.schluessel} checked={data.rolle.rechte.includes(recht.schluessel)} />
						<span>{recht.label}</span>
					</label>
				{/each}
			</fieldset>
		</Abschnitt>
		<p class="kd-info ui-lesetext">
			Wer „Einstellungen verwalten“ hat, muss sich künftig mit einem zweiten Faktor anmelden und wird dafür einmal abgemeldet.
		</p>
		<FormFuss>
			<a href="/einstellungen/rollen" class="kd-knopf hell">Abbrechen</a>
			<button type="submit" class="kd-knopf">Speichern</button>
		</FormFuss>
	</form>

	<form method="POST" action="?/loeschen" use:enhance class="rl-loeschen">
		<button type="submit" class="kd-knopf gefahr">Rolle löschen</button>
	</form>
</main>

<style>
	.rl-rechte {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.1rem 1.5rem;
	}
	.rl-recht {
		font-weight: 500 !important;
	}
	.rl-loeschen {
		margin-top: 2rem;
	}
</style>
