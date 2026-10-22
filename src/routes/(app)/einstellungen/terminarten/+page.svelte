<script lang="ts">
	/**
	 * Terminarten (Jamil msg 3074): eine Liste für Plantafel und Online-Buchung. Reihenfolge = Reihenfolge in der
	 * Auswahl „Terminart“ im Einsatz-Dialog und auf der Buchungsseite.
	 */
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { dauerText, MODUS_NAMEN, ORT_NAMEN } from '$lib/buchung';
	import { FARB_PALETTE } from '$lib/farben';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const anzahl = $derived(data.terminarten.length);
</script>

<svelte:head>
	<title>Terminarten</title>
</svelte:head>

<main class="kd-seite ta-seite">
	<h1>Terminarten</h1>
	<p class="kd-info ta-intro">
		Eine Liste für alles: Die Terminarten (z. B. „Besichtigung“, „Wartung“) wählt ihr beim Einplanen in der
		<a href="/plantafel">Plantafel</a> aus – mit Farbe und Dauer. Ist eine Terminart <strong>online buchbar</strong>, können Kunden sie auch selbst über die
		<a href="/einstellungen/online-buchung">Online-Buchung</a> buchen. Die Reihenfolge hier ist die Reihenfolge in der Auswahl.
	</p>

	<Abschnitt titel="Terminarten" anzahl={anzahl}>
		{#if anzahl === 0}
			<p class="kd-leer">Noch keine Terminarten. Legt die erste an, z. B. „Besichtigung, 60 Minuten“.</p>
		{:else}
			<ol class="ta-liste" aria-label="Terminarten">
				{#each data.terminarten as t, i (t.id)}
					<li class:aus={!t.aktiv} data-testid="terminart">
						<a href={`/einstellungen/terminarten/${t.id}`} class="ta-name">
							<span class="ta-farbe" style:background={t.farbe} aria-hidden="true"></span>
							<span class="ta-text">
								<strong>{t.name}</strong>
								<span class="kd-info">
									{dauerText(t.dauerMin)} · {ORT_NAMEN[t.ortArt]} · {t.onlineBuchbar ? MODUS_NAMEN[t.modus].split(' (')[0] : 'nur Plantafel'}
								</span>
							</span>
						</a>
						<span class="ta-marken">
							{#if !t.aktiv}<span class="badge badge-grau">ausgeschaltet</span>{/if}
							{#if t.onlineBuchbar && t.mitarbeiter.length === 0}<span class="badge badge-rot">ohne Mitarbeiter</span>{/if}
							{#if t.kommend > 0}<span class="badge badge-gruen">{t.kommend} gebucht</span>{/if}
							{#each t.mitarbeiter.slice(0, 3) as m (m.id)}<Avatar name={m.name} groesse={24} />{/each}
						</span>
						<div class="ta-knoepfe">
							<form method="POST" action="?/schalten" use:enhance={ohneReset}>
								<input type="hidden" name="id" value={t.id} />
								<input type="hidden" name="feld" value="onlineBuchbar" />
								<label class="kd-haken">
									<input type="checkbox" name="wert" checked={t.onlineBuchbar} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
									<span>online buchbar</span>
								</label>
							</form>
							<form method="POST" action="?/schalten" use:enhance={ohneReset}>
								<input type="hidden" name="id" value={t.id} />
								<input type="hidden" name="feld" value="aktiv" />
								<label class="kd-haken">
									<input type="checkbox" name="wert" checked={t.aktiv} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
									<span>eingeschaltet</span>
								</label>
							</form>
							<form method="POST" action="?/verschieben" use:enhance>
								<input type="hidden" name="id" value={t.id} />
								<button type="submit" name="richtung" value="hoch" class="kd-knopf hell klein" disabled={i === 0} aria-label={`${t.name} nach oben`}>↑</button>
								<button type="submit" name="richtung" value="runter" class="kd-knopf hell klein" disabled={i === anzahl - 1} aria-label={`${t.name} nach unten`}>↓</button>
							</form>
						</div>
						{#if fehlerIn(t.id)}<p role="alert" class="kd-fehler">{fehlerIn(t.id)}</p>{/if}
					</li>
				{/each}
			</ol>
		{/if}
		<AddPanel label="Terminart hinzufügen" offen={!!fehlerIn('neu')}>
			{#snippet children(schliessen)}
				<form method="POST" action="?/anlegen" use:enhance class="kd-formular">
					{#if fehlerIn('neu')}<p role="alert" class="kd-fehler">{fehlerIn('neu')}</p>{/if}
					<label>Name <input type="text" name="name" maxlength="100" required placeholder="z. B. Besichtigung, Wartung, Aufmaß" /></label>
					<label class="ta-kurz">Dauer (Minuten) <input type="number" name="dauerMin" min="5" max="720" step="5" value="60" required /></label>
					<label class="ta-farbwahl">Farbe <input type="color" name="farbe" value={FARB_PALETTE[anzahl % FARB_PALETTE.length]} /></label>
					<Schalter name="onlineBuchbar" an={true} label="Online buchbar" hinweis="Kunden können diese Terminart selbst buchen" />
					<fieldset class="ta-wahl">
						<legend>Wer wird online gebucht?</legend>
						<Segmente
							name="modus"
							label="Wer wird online gebucht?"
							wert="beliebig"
							optionen={[
								{ wert: 'beliebig', text: 'Beliebiger freier Mitarbeiter (abwechselnd)' },
								{ wert: 'fest', text: 'Fester Mitarbeiter (genau einer)' }
							]}
						/>
					</fieldset>
					<div class="ui-feld">
						Mitarbeiter (Online-Buchung)
						<input type="hidden" name="mitarbeiterGesendet" value="1" />
						<PersonWahl name="mitarbeiter" mehrfach label="Mitarbeiter" leerText="Mitarbeiter wählen" personen={data.mitarbeiter} />
					</div>
					<div class="kd-aktionen">
						<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
						<button type="submit" class="kd-knopf">Anlegen</button>
					</div>
				</form>
			{/snippet}
		</AddPanel>
	</Abschnitt>
</main>

<style>
	.ta-seite {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.ta-intro {
		line-height: 1.7;
		margin: 0;
	}
	.ta-liste {
		list-style: none;
		margin: 0 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.ta-liste li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.ta-liste li.aus {
		background: var(--ui-grau-hell);
	}
	.ta-liste li.aus .ta-text {
		opacity: 0.7;
	}
	.ta-name {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1 1 16rem;
		min-width: 0;
		color: var(--ui-text);
		text-decoration: none;
	}
	.ta-name:hover strong {
		color: var(--ui-akzent-text);
	}
	.ta-farbe {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 999px;
		flex: none;
	}
	.ta-text {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.ta-marken {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}
	.ta-knoepfe,
	.ta-knoepfe form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.6rem;
	}
	.ta-kurz {
		max-width: 12rem;
	}
	.ta-farbwahl input {
		width: 4rem !important;
		height: 2.5rem;
		padding: 0.15rem !important;
	}
	.ta-wahl {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.ta-wahl legend {
		font-weight: 600;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
</style>
