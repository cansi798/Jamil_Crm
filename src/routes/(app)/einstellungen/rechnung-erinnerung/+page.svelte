<script lang="ts">
	/**
	 * Erinnerung „Rechnung erstellen“ (Jamil msgs 6525/6527/6530): Bei „Abgenommen“ legt das CRM nur eine Aufgabe an, keine
	 * Rechnung. Hier stellt der Betrieb ein, wer sie bekommt. Aufbau wie die anderen Einstellungsseiten (Seitenkopf mit ⓘ,
	 * Abschnitt, Formular-Fuß unten rechts).
	 */
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import Knopf from '$lib/components/ui/Knopf.svelte';
	import { ZUWEISUNG_NAMEN, ZUWEISUNGEN } from '$lib/rechnung-erinnerung';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let zuweisung = $state<string>(data.einstellung.zuweisung);
	let benutzerId = $state(data.einstellung.benutzerId ?? '');
</script>

<svelte:head><title>Erinnerung „Rechnung erstellen“ – Einstellungen</title></svelte:head>

<main class="kd-seite re-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Erinnerung „Rechnung erstellen“</h1>
			<p class="seiten-meta">
				<span class="meta-text">Bei „Abgenommen“ entsteht nur eine Aufgabe – keine Rechnung.</span><InfoFenster id="rechnung_erinnerung.seite" />
			</p>
		</div>
	</header>
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.gespeichert}<p role="status" class="kd-info re-ok">Gespeichert.</p>{/if}

	<Abschnitt titel="Wer bekommt die Erinnerung?" info="rechnung_erinnerung.zuweisung">
		<p class="kd-info">
			Wechselt ein Auftrag auf „Abgenommen“, legt das CRM die Aufgabe „Rechnung für Auftrag … erstellen“ an – fällig in zwei Werktagen,
			mit Glocke und Link zum Auftrag. Je Auftrag gibt es sie nur einmal. Danach lässt sie sich wie jede Aufgabe einer anderen Person zuweisen.
		</p>
		<form method="POST" action="?/speichern" class="kd-formular re-form" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<label>
				Zuweisen an
				<Auswahl name="zuweisung" bind:value={zuweisung}>
					{#each ZUWEISUNGEN as z (z)}<option value={z}>{ZUWEISUNG_NAMEN[z]}</option>{/each}
				</Auswahl>
			</label>
			{#if zuweisung === 'person'}
				<div class="ui-feld">
					Person
					<PersonWahl name="benutzerId" label="Person" leerText="Bitte wählen" personen={data.mitarbeiter} bind:wert={benutzerId} />
				</div>
			{:else if zuweisung === 'rolle'}
				<label>
					Rolle
					<Auswahl name="rolleId">
						<option value="">Bitte wählen</option>
						{#each data.rollen as r (r.id)}<option value={r.id} selected={data.einstellung.rolleId === r.id}>{r.name}</option>{/each}
					</Auswahl>
				</label>
			{/if}
			<FormFuss>
				<Knopf type="submit">Speichern</Knopf>
			</FormFuss>
		</form>
	</Abschnitt>
</main>

<style>
	.re-form {
		display: grid;
		gap: var(--ui-feld-abstand);
		max-width: 36rem;
	}
	.re-ok {
		color: var(--ui-gruen);
	}
</style>
