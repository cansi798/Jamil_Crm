<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import BuchungenListe from '$lib/components/BuchungenListe.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { dauerText, MODUS_NAMEN, ORT_NAMEN } from '$lib/buchung';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>Online-Buchung</title>
</svelte:head>

<main class="kd-seite ob-seite">
	<h1>Online-Buchung</h1>
	<p class="kd-info ob-intro">
		Kunden buchen Termine selbst über einen Link oder direkt auf eurer Website. Buchbar sind die <strong>Terminarten</strong>, bei denen
		„online buchbar“ eingeschaltet ist – mit Dauer, Mitarbeitern und eigenen Fragen. Angelegt und geändert werden sie unter
		<a href="/einstellungen/terminarten">Terminarten</a>. Gebucht werden nur freie Zeiten aus den
		<a href="/einstellungen/online-buchung/zeiten">Arbeitszeiten</a> – Termine in der Plantafel, Urlaub und andere Buchungen sind automatisch belegt.
	<InfoFenster id="buchung.seite" /></p>

	<Abschnitt titel="Online buchbare Terminarten" anzahl={data.terminarten.length}>
		{#if data.terminarten.length === 0}
			<p class="kd-leer">
				Noch keine Terminart ist online buchbar. Unter <a href="/einstellungen/terminarten">Terminarten</a> eine anlegen oder „online buchbar“ einschalten.
			</p>
		{:else}
			<ul class="ob-dienste" aria-label="Online buchbare Terminarten">
				{#each data.terminarten as d (d.id)}
					<li class:aus={!d.aktiv}>
						<a href={`/einstellungen/terminarten/${d.id}`} class="ob-dienst">
							<span class="ob-farbe" style:background={d.farbe} aria-hidden="true"></span>
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
		{#if data.andere > 0}
			<p class="kd-info">{data.andere} weitere {data.andere === 1 ? 'Terminart ist' : 'Terminarten sind'} nur in der Plantafel wählbar.</p>
		{/if}
	</Abschnitt>

	<BuchungenListe buchungen={data.buchungen} leer="Keine kommenden Buchungen." />

	<Abschnitt titel="Datenschutz und Website" info="buchung.datenschutz">
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
	.ob-ok {
		color: var(--ui-gruen);
		font-weight: 600;
	}
</style>
