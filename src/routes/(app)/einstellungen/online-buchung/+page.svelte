<script lang="ts">
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { dauerText, MODUS_NAMEN, ORT_NAMEN } from '$lib/buchung';
	import { berlinTag, berlinUhrzeit, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const wann = (iso: string) => `${tagKurz(berlinTag(new Date(iso)))} ${berlinUhrzeit(new Date(iso))}`;
</script>

<svelte:head>
	<title>Online-Buchung</title>
</svelte:head>

<main class="kd-seite ob-seite">
	<h1>Online-Buchung</h1>
	<p class="kd-info ob-intro">
		Kunden buchen Termine selbst über einen Link oder direkt auf eurer Website. Jeder <strong>Dienst</strong> ist eine Terminart (z. B.
		„Besichtigung“) mit Dauer, Mitarbeitern und eigenen Fragen. Gebucht werden nur freie Zeiten aus den
		<a href="/einstellungen/online-buchung/zeiten">Arbeitszeiten</a> – Termine in der Plantafel, Urlaub und andere Buchungen sind automatisch belegt.
	</p>

	<Abschnitt titel="Dienste" anzahl={data.dienste.length}>
		{#if data.dienste.length === 0}
			<p class="kd-leer">Noch keine Dienste. Legt den ersten an, z. B. „Besichtigung, 60 Minuten“.</p>
		{:else}
			<ul class="ob-dienste" aria-label="Dienste">
				{#each data.dienste as d (d.id)}
					<li class:aus={!d.aktiv}>
						<a href={`/einstellungen/online-buchung/${d.id}`} class="ob-dienst">
							<span class="ob-farbe" style={`background:${d.farbe}`} aria-hidden="true"></span>
							<span class="ob-text">
								<strong>{d.name}</strong>
								<span class="kd-info">
									{dauerText(d.dauerMin)} · {ORT_NAMEN[d.ortArt]} · {MODUS_NAMEN[d.modus].split(' (')[0]}{d.aktiv ? '' : ' · ausgeschaltet'}
								</span>
							</span>
							<span class="ob-personen" aria-label="Mitarbeiter">
								{#each d.mitarbeiter.slice(0, 4) as m (m.id)}<Avatar name={m.name} groesse={26} />{/each}
								{#if d.mitarbeiter.length === 0}<span class="badge badge-rot">ohne Mitarbeiter</span>{/if}
							</span>
							{#if d.kommend > 0}<span class="badge badge-blau">{d.kommend} gebucht</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		<AddPanel label="Dienst hinzufügen" offen={!!fehlerIn('neu')}>
			{#snippet children(schliessen)}
				<form method="POST" action="?/anlegen" use:enhance class="kd-formular">
					{#if fehlerIn('neu')}<p role="alert" class="kd-fehler">{fehlerIn('neu')}</p>{/if}
					<label>Name <input type="text" name="name" maxlength="100" required placeholder="z. B. Besichtigung, Vor-Ort-Termin" /></label>
					<label class="ob-kurz">Dauer (Minuten) <input type="number" name="dauerMin" min="5" max="720" step="5" value="60" required /></label>
					<fieldset class="ob-wahl">
						<legend>Wer wird gebucht?</legend>
						<Segmente
							name="modus"
							label="Wer wird gebucht?"
							wert="beliebig"
							optionen={[
								{ wert: 'beliebig', text: 'Beliebiger freier Mitarbeiter (abwechselnd)' },
								{ wert: 'fest', text: 'Fester Mitarbeiter (genau einer)' }
							]}
						/>
					</fieldset>
					<div class="ui-feld">
						Mitarbeiter
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

	<Abschnitt titel="Kommende Buchungen" anzahl={data.buchungen.filter((b) => b.status === 'aktiv').length}>
		{#if data.buchungen.length === 0}
			<p class="kd-leer">Noch keine Buchungen.</p>
		{:else}
			<ul class="kd-liste ob-buchungen">
				{#each data.buchungen as b (b.id)}
					<li class:aus={b.status !== 'aktiv'}>
						<span class="ob-wann">{wann(b.beginn)}</span>
						<span>{b.dienstName} – {b.kundeName}</span>
						<span class="kd-info">{b.mitarbeiterName}{b.status !== 'aktiv' ? ' · abgesagt' : ''}</span>
						{#if b.auftragId}<a href={`/auftraege/${b.auftragId}`}>Auftrag</a>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Abschnitt>

	<Abschnitt titel="Datenschutz und Website">
		<form method="POST" action="?/einstellungen" use:enhance={ohneReset} class="kd-formular">
			{#if fehlerIn('einstellungen')}<p role="alert" class="kd-fehler">{fehlerIn('einstellungen')}</p>{:else if form && 'gespeichert' in form}<p role="status" class="ob-ok">Gespeichert.</p>{/if}
			<label>
				Link zur Datenschutzerklärung (erscheint bei der Zustimmung auf der Buchungsseite)
				<input type="url" name="datenschutzUrl" maxlength="500" placeholder="https://www.ihre-firma.de/datenschutz" value={data.einstellungen.datenschutzUrl ?? ''} />
			</label>
			<label>
				Websites, auf denen die Buchung eingebettet werden darf (eine je Zeile)
				<textarea name="einbettenDomains" rows="3" placeholder="www.ihre-firma.de">{data.einstellungen.einbettenDomains.join('\n')}</textarea>
			</label>
			<p class="kd-info">Nur hier eingetragene Websites dürfen die Buchungsseite in einem Rahmen (iframe) zeigen. Der normale Link funktioniert immer.</p>
			<div class="kd-aktionen"><button type="submit" class="kd-knopf">Speichern</button></div>
		</form>
	</Abschnitt>
</main>

<style>
	.ob-seite {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.ob-intro {
		line-height: 1.7;
		margin: 0;
	}
	.ob-dienste {
		list-style: none;
		margin: 0 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.ob-dienst {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		text-decoration: none;
	}
	.ob-dienst:hover {
		border-color: var(--ui-akzent);
	}
	li.aus .ob-dienst {
		opacity: 0.65;
	}
	.ob-farbe {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 999px;
		flex: none;
	}
	.ob-text {
		display: grid;
		flex: 1 1 14rem;
		gap: 0.15rem;
	}
	.ob-personen {
		display: flex;
		gap: 0.2rem;
	}
	.ob-kurz {
		max-width: 12rem;
	}
	.ob-wahl {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0.5rem 0.75rem 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
	}
	.ob-wahl legend {
		font-weight: 600;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.ob-buchungen li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.ob-buchungen li.aus {
		text-decoration: line-through;
		color: var(--ui-text-leise);
	}
	.ob-wann {
		font-weight: 600;
		min-width: 8rem;
	}
	.ob-ok {
		color: var(--ui-gruen);
		font-weight: 600;
	}
</style>
