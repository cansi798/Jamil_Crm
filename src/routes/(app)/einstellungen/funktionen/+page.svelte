<script lang="ts">
	/**
	 * Funktionen & Automatisierungen (Jamil, Talk msg 3423): was das CRM von selbst tut – nach dem Weg des Kunden
	 * geordnet. Pro Funktion: was passiert, wann es auslöst, Zustand (bei zwei Funktionen direkt umschaltbar) und Link zur
	 * Einstellung. Die Liste steht in `$lib/funktionen.ts`.
	 */
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import type { Funktion } from '$lib/funktionen';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** Zustand in einem Satz für Funktionen ohne einzelnen Schalter */
	function zustandText(f: Funktion): string | null {
		const s = data.stand;
		switch (f.zustand) {
			case 'nachfassen':
				return s.nachfassen.gesamt === 0 ? 'Noch keine Stufe angelegt' : `${s.nachfassen.aktiv} von ${s.nachfassen.gesamt} Stufen an`;
			case 'buchung':
				return s.buchung.terminarten === 0 ? 'Keine Terminart online buchbar' : `${s.buchung.terminarten} Terminart${s.buchung.terminarten === 1 ? '' : 'en'} online buchbar`;
			case 'portal_links':
				return s.portalLinks.kunden === 0 ? 'Noch kein Kunde mit Portal-Link' : `${s.portalLinks.kunden} Kunde${s.portalLinks.kunden === 1 ? '' : 'n'} mit Portal-Link`;
			default:
				return null;
		}
	}
	const an = (f: Funktion) => (f.zustand === 'ab_automatisch' ? data.stand.ab_automatisch : data.stand.bestand_aktiv);
</script>

<svelte:head><title>Funktionen & Automatisierungen – Einstellungen</title></svelte:head>

<main class="kd-seite fu-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Funktionen & Automatisierungen</h1>
			<p class="seiten-meta">Was das CRM von selbst für Sie tut – geordnet nach dem Weg Ihres Kunden.<InfoFenster id="funktionen.seite" /></p>
		</div>
	</header>
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	{#each data.gruppen as g, i (g.schritt.id)}
		<Abschnitt titel={`${i + 1}. ${g.schritt.titel}`} id={`fu-${g.schritt.id}`} anzahl={g.funktionen.length}>
			<p class="kd-info fu-frage">{g.schritt.frage}</p>
			<ul class="fu-liste">
				{#each g.funktionen as f (f.id)}
					<li data-testid="funktion" data-funktion={f.id}>
						<div class="fu-text">
							<span class="fu-titel"><strong>{f.name}</strong>{#if f.info}<InfoFenster id={f.info} />{/if}</span>
							<span>{f.was}</span>
							<small class="kd-info"><b>Wann:</b> {f.wann}</small>
						</div>
						<div class="fu-rechts">
							{#if f.schalter}
								<form method="POST" action="?/schalten" use:enhance={() => async ({ update }) => update({ reset: false })}>
									<input type="hidden" name="name" value={f.zustand} />
									<input type="hidden" name="wert" value={an(f) ? 'aus' : 'an'} />
									<button type="submit" class="fu-schalter" role="switch" aria-checked={an(f)} aria-label={`${f.name}: ${an(f) ? 'an, zum Ausschalten tippen' : 'aus, zum Einschalten tippen'}`}>
										<span class="fu-bahn" aria-hidden="true"><span class="fu-knopf"></span></span>
										<span>{an(f) ? 'an' : 'aus'}</span>
									</button>
								</form>
							{:else if zustandText(f)}
								<span class="badge badge-grau" data-testid="funktion-zustand">{zustandText(f)}</span>
							{/if}
							<a href={f.href} class="kd-knopf hell klein">Einstellen</a>
						</div>
					</li>
				{/each}
			</ul>
		</Abschnitt>
	{/each}
	{#if data.gruppen.length === 0}<p class="kd-leer">Für Ihren Tarif und Ihre Rechte gibt es hier keine Funktionen.</p>{/if}
</main>

<style>
	.fu-seite {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.fu-frage {
		margin: 0 0 0.5rem;
	}
	.fu-liste {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.fu-liste li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem 1rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.fu-text {
		display: grid;
		flex: 1 1 22rem;
		gap: 0.15rem;
		min-width: 0;
		line-height: 1.55;
	}
	.fu-titel {
		display: flex;
		align-items: center;
	}
	.fu-rechts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem 0.75rem;
	}
	.fu-schalter {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		padding: 0 0.25rem;
		border: 0;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.fu-bahn {
		position: relative;
		width: 2.25rem;
		height: 1.375rem;
		border-radius: 999px;
		background: var(--ui-rand-stark);
	}
	.fu-knopf {
		position: absolute;
		top: 3px;
		left: 3px;
		width: calc(1.375rem - 6px);
		height: calc(1.375rem - 6px);
		border-radius: 999px;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
	}
	.fu-schalter[aria-checked='true'] .fu-bahn {
		background: var(--ui-akzent);
	}
	.fu-schalter[aria-checked='true'] .fu-knopf {
		transform: translateX(0.875rem);
	}
	.fu-schalter:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
		border-radius: 999px;
	}
</style>
