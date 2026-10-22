<script lang="ts">
	import { tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import Mikrofon from './Mikrofon.svelte';
	import NavSymbol from './NavSymbol.svelte';
	import type { SchnellEintrag } from '$lib/schnellzugriff';

	/**
	 * Schnellzugriff unten rechts (Jamil msgs 3078/3079): runder Knopf, Antippen öffnet ein kleines Menü darüber –
	 * Sprachsteuerung, Neuer Kunde, Neuer Auftrag, Neuer Termin, Neue Aufgabe (nur, was Modul und Recht erlauben).
	 * Ist nur die Sprachsteuerung erlaubt, bleibt es beim Mikrofon-Knopf wie bisher. Schließt mit Escape, Klick daneben
	 * und beim Seitenwechsel. Menü-Semantik (menu/menuitem), Pfeiltasten, Fokus zurück auf den Knopf.
	 */
	let { eintraege }: { eintraege: SchnellEintrag[] } = $props();

	const nurSprache = $derived(eintraege.length === 1 && eintraege[0].id === 'sprache');
	const mitSprache = $derived(eintraege.some((e) => e.id === 'sprache'));

	let offen = $state(false);
	let hauptEl = $state<HTMLButtonElement | null>(null);
	let wurzelEl = $state<HTMLDivElement | null>(null);
	let menueEl = $state<HTMLUListElement | null>(null);
	let mikro = $state<ReturnType<typeof Mikrofon> | null>(null);

	const punkte = () => Array.from(menueEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

	async function oeffnen(fokus: 'erster' | 'letzter' = 'erster') {
		offen = true;
		await tick();
		const p = punkte();
		(fokus === 'erster' ? p[0] : p[p.length - 1])?.focus();
	}
	function schliessen(fokusZurueck = true) {
		if (!offen) return;
		offen = false;
		if (fokusZurueck) hauptEl?.focus();
	}
	function umschalten() {
		if (offen) schliessen();
		else void oeffnen();
	}
	function sprache() {
		offen = false;
		mikro?.oeffnen();
	}

	// Seitenwechsel (auch über einen Menüpunkt) schließt das Menü
	afterNavigate(() => {
		offen = false;
	});

	function hauptTaste(e: KeyboardEvent) {
		// Pfeil hoch öffnet und springt zum obersten Punkt, Pfeil runter zum untersten (nah am Knopf)
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			void oeffnen(e.key === 'ArrowUp' ? 'letzter' : 'erster');
		}
	}
	function menueTaste(e: KeyboardEvent) {
		const p = punkte();
		const i = p.indexOf(document.activeElement as HTMLElement);
		// Liste läuft von unten (Knopf) nach oben: Pfeil hoch = nächster Punkt in der Liste
		const ziel = (n: number) => {
			e.preventDefault();
			p[(n + p.length) % p.length]?.focus();
		};
		if (e.key === 'ArrowUp') ziel(i + 1);
		else if (e.key === 'ArrowDown') ziel(i - 1);
		else if (e.key === 'Home') ziel(p.length - 1);
		else if (e.key === 'End') ziel(0);
		else if (e.key === 'Tab') schliessen(false);
	}
	// Klick daneben schließt – auch auf die Navigation (Seitenleiste bzw. Leiste unten), die über dem Schleier liegt
	function fensterDruck(e: PointerEvent) {
		if (offen && wurzelEl && !wurzelEl.contains(e.target as Node)) schliessen(false);
	}
	function fensterTaste(e: KeyboardEvent) {
		if (e.key === 'Escape' && offen) {
			e.preventDefault();
			schliessen();
		}
	}
</script>

<svelte:window onkeydown={fensterTaste} onpointerdown={fensterDruck} />

{#if nurSprache}
	<Mikrofon />
{:else if eintraege.length > 0}
	{#if offen}
		<!-- Schleier über dem Inhalt fängt den Klick daneben ab (schließt über fensterDruck); die Navigation liegt darüber -->
		<div class="sz-schleier" aria-hidden="true"></div>
	{/if}
	<div class="sz" class:offen bind:this={wurzelEl}>
		<ul id="schnellzugriff-menue" class="sz-menue" role="menu" aria-label="Schnellzugriff" bind:this={menueEl} onkeydown={menueTaste}>
			{#each eintraege as e, i (e.id)}
				<li role="none" style:--sz-i={i}>
					{#if e.href}
						<a role="menuitem" class="sz-eintrag" href={e.href} tabindex="-1" data-schnell={e.id} onclick={() => (offen = false)}>
							<span class="sz-text">{e.text}</span>
							<span class="sz-rund" aria-hidden="true">
								{#if e.id === 'kunde'}<NavSymbol symbol="kunden" />
								{:else if e.id === 'auftrag'}<NavSymbol symbol="auftraege" />
								{:else if e.id === 'termin'}<NavSymbol symbol="plantafel" />
								{:else}<NavSymbol symbol="todos" />{/if}
							</span>
						</a>
					{:else}
						<button type="button" role="menuitem" class="sz-eintrag" tabindex="-1" data-schnell={e.id} onclick={sprache}>
							<span class="sz-text">{e.text}</span>
							<span class="sz-rund" aria-hidden="true">
								<svg viewBox="0 0 24 24" width="22" height="22">
									<path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Z" />
									<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
								</svg>
							</span>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="sz-haupt"
			aria-label="Schnellzugriff"
			aria-haspopup="menu"
			aria-expanded={offen}
			aria-controls="schnellzugriff-menue"
			bind:this={hauptEl}
			onclick={umschalten}
			onkeydown={hauptTaste}
		>
			<svg class="sz-plus" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
				<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
			</svg>
		</button>
	</div>
	{#if mitSprache}
		<Mikrofon knopf={false} bind:this={mikro} zurueck={() => hauptEl} />
	{/if}
{/if}

<style>
	/* Gleicher Platz und Stil wie der bisherige Mikrofon-Knopf: Anthrazit, Akzent (Gold bzw. Hausfarbe), heller Ring */
	.sz {
		position: fixed;
		z-index: 20;
		right: 1rem;
		bottom: calc(var(--nav-hoehe) + 0.75rem + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.75rem;
		/* Container selbst fängt keine Klicks ab – nur Knopf und (offenes) Menü */
		pointer-events: none;
	}
	.sz-haupt,
	.sz.offen .sz-menue {
		pointer-events: auto;
	}
	.sz-schleier {
		position: fixed;
		inset: 0;
		/* unter der Leiste unten (z-index 10), über dem Inhalt */
		z-index: 9;
		background: rgba(31, 30, 32, 0.28);
	}
	.sz-haupt {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3.75rem;
		height: 3.75rem;
		padding: 0;
		/* Jamil msg 3107: weißer Rand dünner */
		border: 1.5px solid var(--ui-flaeche);
		border-radius: 50%;
		background: var(--ui-anthrazit-800);
		color: var(--ui-akzent);
		box-shadow: 0 6px 18px rgba(31, 30, 32, 0.35);
		cursor: pointer;
		transition: transform 150ms, background 150ms;
	}
	.sz-haupt:hover {
		background: var(--ui-anthrazit-900);
		transform: translateY(-1px);
	}
	.sz-haupt:focus-visible,
	.sz-eintrag:focus-visible .sz-rund {
		outline: 2px solid var(--ui-akzent);
		outline-offset: 2px;
	}
	/* Fokusrahmen nur am runden Knopf, nicht als Rechteck um die ganze Zeile */
	.sz-eintrag:focus-visible {
		outline: none;
	}
	.sz-plus {
		transition: transform 200ms ease;
	}
	.sz.offen .sz-plus {
		transform: rotate(45deg); /* „+“ wird zu „×“ */
	}

	.sz-menue {
		display: flex;
		/* von unten (am Knopf) nach oben */
		flex-direction: column-reverse;
		align-items: flex-end;
		gap: 0.6rem;
		margin: 0;
		/* Mittelpunkt der kleinen Knöpfe über dem des Hauptknopfs */
		padding: 0 0.4rem 0 0;
		list-style: none;
		visibility: hidden;
		transition: visibility 0s linear 180ms;
	}
	.sz.offen .sz-menue {
		visibility: visible;
		transition: none;
	}
	.sz-menue li {
		opacity: 0;
		transform: translateY(0.75rem) scale(0.9);
		transform-origin: right center;
		transition: opacity 140ms ease, transform 180ms ease;
	}
	.sz.offen .sz-menue li {
		opacity: 1;
		transform: none;
		transition-delay: calc(var(--sz-i) * 35ms);
	}
	.sz-eintrag {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 44px;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.sz-text {
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font-family: var(--ui-schrift-titel);
		font-size: 0.875rem;
		font-weight: 600;
		white-space: nowrap;
		box-shadow: var(--ui-schatten-hoch);
	}
	.sz-rund {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--ui-flaeche);
		border-radius: 50%;
		background: var(--ui-anthrazit-800);
		color: var(--ui-akzent);
		box-shadow: 0 4px 12px rgba(31, 30, 32, 0.3);
		transition: background 150ms;
	}
	.sz-eintrag:hover .sz-rund {
		background: var(--ui-anthrazit-900);
	}
	.sz-eintrag:hover .sz-text {
		background: var(--ui-akzent-hell);
	}
	.sz-rund :global(.nav-symbol) {
		width: 22px;
		height: 22px;
	}

	@media (prefers-reduced-motion: reduce) {
		.sz-haupt,
		.sz-plus,
		.sz-menue,
		.sz-menue li,
		.sz.offen .sz-menue li {
			transition: none;
		}
		.sz-menue li {
			transform: none;
		}
	}
	@media (min-width: 900px) {
		.sz {
			right: 1.5rem;
			bottom: 1.5rem;
		}
	}
</style>
