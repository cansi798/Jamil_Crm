<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import DatumWahl from '$lib/components/ui/DatumWahl.svelte';
	import { tagKurz } from '$lib/zeit';
	import type { ArbeitsZeit } from '$lib/buchung';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
	const ausDaten = (d: PageData): ArbeitsZeit[] =>
		structuredClone((d.dienstId ? d.zeiten?.jeDienst[d.dienstId] : d.zeiten?.allgemein) ?? []) as ArbeitsZeit[];

	let person = $state(untrack(() => data.benutzerId ?? ''));
	let zeiten = $state<ArbeitsZeit[]>(untrack(() => ausDaten(data)));
	let stand = $state(untrack(() => JSON.stringify(ausDaten(data))));
	let ausnahmeTag = $state('');
	let ausnahmeArt = $state<'frei' | 'zusaetzlich'>('frei');
	$effect(() => {
		// andere Person/anderer Dienst geladen → Editor neu füllen
		const neu = ausDaten(data);
		untrack(() => {
			zeiten = neu;
			stand = JSON.stringify(neu);
			person = data.benutzerId ?? '';
		});
	});
	$effect(() => {
		if (person && person !== untrack(() => data.benutzerId)) goto(`?ma=${person}${data.dienstId ? `&dienst=${data.dienstId}` : ''}`, { noScroll: true, keepFocus: true });
	});
	const geaendert = $derived(JSON.stringify(zeiten) !== stand);
	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const zeilenAm = (wt: number) => zeiten.map((z, i) => ({ z, i })).filter((x) => x.z.wochentag === wt);
	const dienstName = $derived(data.dienste.find((d) => d.id === data.dienstId)?.name ?? null);
	const dienste = $derived(data.dienste.filter((d) => d.mitarbeiter.includes(data.benutzerId ?? '')));

	function standard() {
		zeiten = [0, 1, 2, 3, 4].map((wochentag) => ({ wochentag, von: '08:00', bis: '17:00' }));
	}
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>Arbeitszeiten – Online-Buchung</title>
</svelte:head>

<main class="kd-seite oz-seite">
	<a href="/einstellungen/online-buchung" class="kd-zurueck">← Online-Buchung</a>
	<h1>Arbeitszeiten für Buchungen</h1>
	<p class="kd-info oz-intro">
		Nur in diesen Zeiten kann online gebucht werden. Termine in der Plantafel, Urlaub/Krankheit und andere Buchungen werden automatisch abgezogen.
	</p>

	{#if data.mitarbeiter.length === 0}
		<p class="kd-leer">Keine aktiven Mitarbeiter.</p>
	{:else}
		<div class="oz-wahl">
			<PersonWahl name="ma" personen={data.mitarbeiter} bind:wert={person} label="Mitarbeiter" required />
			<label>
				Gilt für
				<Auswahl
					value={data.dienstId ?? ''}
					onchange={(e) => goto(`?ma=${data.benutzerId}${e.currentTarget.value ? `&dienst=${e.currentTarget.value}` : ''}`, { noScroll: true })}
				>
					<option value="">alle Terminarten</option>
					{#each dienste as d (d.id)}<option value={d.id}>nur „{d.name}“{data.zeiten?.jeDienst[d.id] ? ' (eigene Zeiten)' : ''}</option>{/each}
				</Auswahl>
			</label>
		</div>

		<Abschnitt titel={dienstName ? `Wochenzeiten nur für „${dienstName}“` : 'Wochenzeiten (alle Terminarten)'}>
			{#if dienstName}
				<p class="kd-info">Sind hier Zeiten eingetragen, gelten für „{dienstName}“ nur diese. Leer = die allgemeinen Zeiten gelten.</p>
			{/if}
			<form method="POST" action="?/speichern" use:enhance={ohneReset} class="oz-woche">
				<input type="hidden" name="benutzerId" value={data.benutzerId} />
				<input type="hidden" name="dienstId" value={data.dienstId ?? ''} />
				<input type="hidden" name="zeiten" value={JSON.stringify(zeiten)} />
				{#each TAGE as name, wt (wt)}
					<div class="oz-tag">
						<span class="oz-name">{name}</span>
						<div class="oz-zeilen">
							{#each zeilenAm(wt) as { z, i } (i)}
								<span class="oz-zeile">
									<input type="time" bind:value={z.von} aria-label={`${name} von`} step="900" />
									<span aria-hidden="true">–</span>
									<input type="time" bind:value={z.bis} aria-label={`${name} bis`} step="900" />
									<button use:rueckfrage={{ frage: 'Zeit wirklich entfernen?', ja: 'Entfernen' }} type="button" class="oz-x" aria-label={`${name}: Zeit entfernen`} onclick={() => zeiten.splice(i, 1)}>✕</button>
								</span>
							{:else}
								<span class="kd-info">nicht buchbar</span>
							{/each}
						</div>
						<button type="button" class="knopf-subtil klein" onclick={() => zeiten.push({ wochentag: wt, von: '08:00', bis: '12:00' })} aria-label={`${name}: Zeit hinzufügen`}>+ Zeit</button>
					</div>
				{/each}
				{#if fehlerIn('zeiten')}<p class="kd-fehler" role="alert">{fehlerIn('zeiten')}</p>{:else if form && form.bereich === 'zeiten' && 'gespeichert' in form && !geaendert}<p class="oz-ok" role="status">Gespeichert.</p>{/if}
				<div class="kd-aktionen">
					<button type="submit" class="kd-knopf" disabled={!geaendert} data-testid="zeiten-speichern">Speichern</button>
					<button type="button" class="kd-knopf hell" onclick={standard}>Mo–Fr 8–17 Uhr eintragen</button>
				</div>
			</form>
		</Abschnitt>

		<Abschnitt titel="Ausnahmen" anzahl={data.zeiten?.ausnahmen.length ?? 0}>
			{#if (data.zeiten?.ausnahmen.length ?? 0) === 0}
				<p class="kd-leer">Keine Ausnahmen. Urlaub und Krankheit aus „Abwesenheiten“ zählen automatisch.</p>
			{:else}
				<ul class="kd-liste">
					{#each data.zeiten?.ausnahmen ?? [] as a (a.id)}
						<li class="oz-ausnahme">
							<span><strong>{tagKurz(a.tag)}</strong> {a.art === 'frei' ? (a.von ? `nicht buchbar ${a.von}–${a.bis}` : 'ganzer Tag nicht buchbar') : `zusätzlich ${a.von}–${a.bis}`}{a.notiz ? ` · ${a.notiz}` : ''}</span>
							<form method="POST" action="?/ausnahmeLoeschen" use:enhance>
								<input type="hidden" name="id" value={a.id} />
								<button type="submit" class="knopf-subtil klein" aria-label="Ausnahme löschen" use:rueckfrage={'Ausnahme wirklich löschen?'}>✕</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
			<AddPanel label="Ausnahme hinzufügen" offen={!!fehlerIn('ausnahme')}>
				{#snippet children(schliessen)}
					<form method="POST" action="?/ausnahme" use:enhance class="kd-formular">
						{#if fehlerIn('ausnahme')}<p class="kd-fehler" role="alert">{fehlerIn('ausnahme')}</p>{/if}
						<input type="hidden" name="benutzerId" value={data.benutzerId} />
						<DatumWahl name="tag" bind:wert={ausnahmeTag} label="Tag" />
						<fieldset class="oz-art">
							<Segmente
								name="art"
								label="Art der Ausnahme"
								bind:wert={ausnahmeArt}
								optionen={[
									{ wert: 'frei', text: 'nicht buchbar' },
									{ wert: 'zusaetzlich', text: 'zusätzlich buchbar' }
								]}
							/>
						</fieldset>
						<div class="kd-zwei">
							<label>von {ausnahmeArt === 'frei' ? '(leer = ganzer Tag)' : ''}<input type="time" name="von" step="900" /></label>
							<label>bis <input type="time" name="bis" step="900" /></label>
						</div>
						<label>Notiz (optional) <input type="text" name="notiz" maxlength="200" /></label>
						<div class="kd-aktionen">
							<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
							<button type="submit" class="kd-knopf">Hinzufügen</button>
						</div>
					</form>
				{/snippet}
			</AddPanel>
		</Abschnitt>
	{/if}
</main>

<style>
	.oz-seite {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.oz-intro {
		line-height: 1.7;
		margin: 0;
	}
	.oz-wahl {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 1rem;
	}
	.oz-wahl label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		color: var(--ui-text-leise);
	}
	.oz-woche {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.oz-tag {
		display: grid;
		grid-template-columns: 7rem 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--ui-rand);
	}
	.oz-name {
		font-weight: 600;
	}
	.oz-zeilen {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
	}
	.oz-zeile {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.oz-zeile input {
		width: 7rem !important;
	}
	.oz-x {
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--ui-text-leise);
		cursor: pointer;
	}
	.oz-x:hover {
		background: var(--ui-akzent-hell);
	}
	@media (max-width: 560px) {
		.oz-tag {
			grid-template-columns: 1fr auto;
		}
		.oz-zeilen {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}
	.oz-ok {
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.oz-art {
		display: flex;
		gap: 1rem;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.oz-ausnahme {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
</style>
