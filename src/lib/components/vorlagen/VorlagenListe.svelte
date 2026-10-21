<script lang="ts" module>
	/** Eine Zeile der Vorlagen-Liste: Name (+ Abzeichen), eine Zeile Kennzahlen, optional die Beschreibung. */
	export type VorlagenZeile = {
		id: string;
		name: string;
		/** Detailseite; ohne Link nur Text (z. B. archiviert) */
		href?: string | null;
		meta?: string | null;
		beschreibung?: string | null;
		/** kleines Abzeichen neben dem Namen, z. B. „Standard“ */
		abzeichen?: string | null;
	};
</script>

<script lang="ts" generics="T extends VorlagenZeile">
	import type { Snippet } from 'svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';

	/**
	 * DIE Liste jeder Vorlagen-Seite (Jamil msg 3084): Karte mit Kopfband („Vorlagen“ + Anzahl), je Zeile Name, Kennzahl-
	 * Zeile und Beschreibung; Zeilen-Aktionen (Duplizieren, Archivieren, Als Standard …) rechts als klare, umrandete
	 * Knöpfe (`ZeilenAktion`) – am Handy darunter. Leer: Symbol + Satz + passender Knopf.
	 */
	let {
		titel = 'Vorlagen',
		label,
		hinweis,
		eintraege,
		aktionen,
		leer,
		leerAktion,
		kopfAktionen
	}: {
		titel?: string;
		/** Name der Liste für Screenreader (Standard: Titel) */
		label?: string;
		/** kurzer Satz über der Liste */
		hinweis?: string | null;
		eintraege: readonly T[];
		/** Aktionen je Zeile */
		aktionen?: Snippet<[T]>;
		leer: string;
		leerAktion?: Snippet;
		kopfAktionen?: Snippet;
	} = $props();
</script>

<Abschnitt {titel} anzahl={eintraege.length} aktionen={kopfAktionen}>
	{#if hinweis}<p class="kd-info vl-hinweis">{hinweis}</p>{/if}
	<ul class="vl-liste" aria-label={label ?? titel}>
		{#each eintraege as e (e.id)}
			<li class="vl-zeile">
				{#if e.href}
					<a href={e.href} class="vl-inhalt">{@render inhalt(e)}</a>
				{:else}
					<div class="vl-inhalt">{@render inhalt(e)}</div>
				{/if}
				{#if aktionen}<div class="vl-aktionen">{@render aktionen(e)}</div>{/if}
			</li>
		{:else}
			<li class="kd-leer">
				<span>{leer}</span>
				{#if leerAktion}{@render leerAktion()}{/if}
			</li>
		{/each}
	</ul>
</Abschnitt>

{#snippet inhalt(e: VorlagenZeile)}
	<span class="vl-name"><strong>{e.name}</strong>{#if e.abzeichen}<span class="vl-abzeichen">{e.abzeichen}</span>{/if}</span>
	{#if e.meta}<span class="kd-info vl-meta">{e.meta}</span>{/if}
	{#if e.beschreibung}<span class="vl-beschreibung">{e.beschreibung}</span>{/if}
{/snippet}

<style>
	.vl-hinweis {
		margin: 0 0 var(--ui-a3);
	}
	.vl-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		overflow: hidden;
	}
	.vl-zeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--ui-a2) var(--ui-a3);
		padding: 0 var(--ui-a3) 0 0;
		transition: background 120ms;
	}
	.vl-zeile + .vl-zeile {
		border-top: 1px solid var(--ui-rand);
	}
	.vl-zeile:has(a.vl-inhalt:hover) {
		background: var(--ui-akzent-zart);
	}
	.vl-inhalt {
		display: grid;
		gap: 0.15rem;
		flex: 1 1 18rem;
		min-width: 0;
		min-height: 3.25rem;
		padding: 0.7rem 0 0.7rem var(--ui-a3);
		color: var(--ui-text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	a.vl-inhalt:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.vl-name {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.vl-abzeichen {
		padding: 0.1rem 0.5rem;
		border-radius: var(--ui-chip-radius);
		background: var(--ui-akzent-zart);
		color: var(--ui-akzent-text);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
	}
	.vl-beschreibung {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.vl-aktionen {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--ui-a2);
		margin-left: auto;
	}
	.vl-aktionen :global(form) {
		margin: 0;
	}
	/* Handy: Aktionen unter dem Text, rechtsbündig */
	@media (max-width: 640px) {
		.vl-zeile {
			padding: 0 var(--ui-a3) var(--ui-a2) 0;
		}
		.vl-inhalt {
			flex-basis: 100%;
			padding-bottom: 0.25rem;
		}
		.vl-aktionen {
			padding-left: var(--ui-a3);
		}
	}
</style>
