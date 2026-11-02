<script lang="ts">
	import { berlinUhrzeit } from '$lib/zeit';
	import type { HeuteEinsatz } from '$lib/heute-kopie';
	import KontaktwegChip from '$lib/components/KontaktwegChip.svelte';
	import { istKontaktweg } from '$lib/kontaktweg';
	import LeitfadenFlaeche from '$lib/components/LeitfadenFlaeche.svelte';
	import { STATUS_NAMEN } from '$lib/leitfaden';
	import { wartend } from '$lib/leitfaden-ausgang';

	/**
	 * „Meine Einsätze heute“ als Karten: Uhrzeit, Kunde, Adresse (öffnet Google Maps in neuem Tab) und Auftrag.
	 * Wird auf „Start“ (frisch vom Server) und auf der Offline-Seite (Kopie vom Gerät) benutzt.
	 */
	let { einsaetze, offline = false }: { einsaetze: HeuteEinsatz[]; offline?: boolean } = $props();

	// Nur http(s) – auch aus der Kopie auf dem Gerät
	const sichereLinks = (l: HeuteEinsatz['links']) => (Array.isArray(l) ? l.filter((x) => typeof x?.url === 'string' && /^https?:\/\//i.test(x.url)).slice(0, 10) : []);
	// Offline: Leitfaden direkt hier öffnen (Kopie vom Gerät, Eingaben gehen später raus – Jamil msg 4340, 4b)
	let offenerLeitfaden = $state<string | null>(null);
	const wartet = (id: string) => (typeof window === 'undefined' ? 0 : wartend(id).length);
	const karte = (ort: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ort)}`;
</script>

<ul class="heute-liste">
	{#each einsaetze as e (e.id)}
		<li class="heute-karte">
			<span class="heute-zeit">{berlinUhrzeit(new Date(e.beginn))}–{berlinUhrzeit(new Date(e.ende))}</span>
			<strong class="heute-kunde">{e.kundeName}</strong>
			{#if e.ort}
				<a class="heute-ort" href={karte(e.ort)} target="_blank" rel="noopener noreferrer">{e.ort}</a>
			{/if}
			{#if offline}
				<span class="heute-auftrag">{e.auftragNummer ? `${e.auftragNummer} · ` : ''}{e.auftragTitel}</span>
			{:else}
				{#if e.auftragId}<a class="heute-auftrag" href={`/auftraege/${e.auftragId}`}>{e.auftragNummer} · {e.auftragTitel}</a>{:else}<span class="heute-auftrag">📌 {e.auftragTitel} (eigener Termin)</span>{/if}
			{/if}
			{#if e.kundeImBestand}
				<!-- Bevorzugter Kontaktweg des Kunden (Jamil msg 4337) -->
				<span class="heute-kontakt" data-testid="heute-kontaktweg">Kontaktweg: {#if istKontaktweg(e.kontaktweg)}<KontaktwegChip weg={e.kontaktweg} kurz />{:else}keine Angabe{/if}</span>
			{/if}
			{#if e.leitfaden}
				<!-- Leitfaden beim Termin (Jamil msgs 4302/4304) -->
				<div class="heute-leitfaden" data-testid="heute-leitfaden">
					{#if e.leitfaden.status !== 'offen'}
						<span class="ah-chip gut">✓ {e.leitfaden.name}: {STATUS_NAMEN[e.leitfaden.status]}</span>
					{:else if offline}
						<button type="button" class="kd-knopf" onclick={() => (offenerLeitfaden = offenerLeitfaden === e.id ? null : e.id)}>
							{offenerLeitfaden === e.id ? 'Leitfaden schließen' : `Leitfaden ${e.leitfaden.erledigt > 0 ? 'fortsetzen' : 'starten'} · ${e.leitfaden.erledigt}/${e.leitfaden.gesamt}`}
						</button>
					{:else}
						<a class="kd-knopf" href={`/leitfaden/${e.id}`}>Leitfaden {e.leitfaden.erledigt > 0 ? 'fortsetzen' : 'starten'} · {e.leitfaden.erledigt}/{e.leitfaden.gesamt}</a>
					{/if}
					{#if wartet(e.id) > 0}<span class="ah-chip warnung">{wartet(e.id)} Eingabe(n) warten auf Netz</span>{/if}
				</div>
				{#if offline && offenerLeitfaden === e.id}
					<LeitfadenFlaeche
						offline
						stand={{ einsatzId: e.id, name: e.leitfaden.name, kundeName: e.kundeName, auftragNummer: e.auftragNummer, auftragTitel: e.auftragTitel, terminBeginn: e.beginn, schritte: e.leitfaden.schritte, antworten: e.leitfaden.antworten, kunde: e.leitfaden.kunde, status: e.leitfaden.status, begruendung: e.leitfaden.begruendung }}
					/>
				{/if}
			{/if}
			{#if e.notiz}<span class="heute-notiz">{e.notiz}</span>{/if}
			{#each sichereLinks(e.links) as l (l.url)}
				<a class="heute-link" href={l.url} target="_blank" rel="noopener noreferrer external">🔗 {l.titel} <small>{l.domain}</small></a>
			{/each}
		</li>
	{:else}
		<li class="heute-leer">Heute keine Einsätze</li>
	{/each}
</ul>

<style>
	.heute-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.heute-karte {
		display: grid;
		gap: 0.2rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--rand);
		border-left: 5px solid var(--primaer);
		border-radius: 0.5rem;
		background: var(--flaeche);
	}
	.heute-leitfaden {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.25rem;
	}
	.heute-kontakt {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.875rem;
		color: var(--ui-text-leise);
	}
	.heute-zeit {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.heute-kunde {
		font-size: 1.05rem;
	}
	.heute-link {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
		min-height: 44px;
		align-items: center;
		overflow-wrap: anywhere;
	}
	.heute-link small {
		color: var(--ui-text-leise);
	}
	.heute-ort,
	a.heute-auftrag {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--ui-akzent-text);
	}
	.heute-auftrag {
		color: var(--text-leise);
	}
	.heute-notiz {
		color: var(--text-leise);
		font-size: 0.9rem;
		white-space: pre-wrap;
	}
	.heute-leer {
		padding: 0.75rem;
		border: 1px dashed var(--rand);
		border-radius: 0.5rem;
		color: var(--text-leise);
	}
</style>
