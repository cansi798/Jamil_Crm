<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	/**
	 * DER Knopf der App (docs/design-regeln.md): vier Arten, eine Höhe, Symbol immer links vom Text.
	 * Mit `href` als Link, sonst als <button> (Standard type="button"; für Formulare type="submit").
	 *   primaer   – Hauptaktion (je Bereich höchstens eine)
	 *   sekundaer – weitere Aktionen, „Abbrechen“
	 *   ghost     – leise Aktionen in Listen/Zeilen
	 *   gefahr    – Löschen, Deaktivieren
	 */
	type Art = 'primaer' | 'sekundaer' | 'ghost' | 'gefahr';
	type Symbol = 'plus' | 'speichern' | 'zurueck' | 'weiter' | 'loeschen' | 'bearbeiten' | 'suchen' | 'filter' | 'kalender' | 'person';
	let {
		art = 'primaer',
		symbol,
		href,
		voll = false,
		klein = false,
		children,
		...rest
	}: {
		art?: Art;
		symbol?: Symbol;
		href?: string;
		voll?: boolean;
		klein?: boolean;
		children: Snippet;
	} & Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'children'> = $props();

	const KLASSE: Record<Art, string> = {
		primaer: 'kd-knopf',
		sekundaer: 'kd-knopf hell',
		ghost: 'knopf-ghost',
		gefahr: 'kd-knopf gefahr'
	};
	const PFADE: Record<Symbol, string> = {
		plus: 'M8 3v10M3 8h10',
		speichern: 'M3.5 8.5l3 3 6-7',
		zurueck: 'M9.5 3.5 5 8l4.5 4.5',
		weiter: 'M6.5 3.5 11 8l-4.5 4.5',
		loeschen: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5',
		bearbeiten: 'M10.5 3 13 5.5 6 12.5H3.5V10Z',
		suchen: 'M7 2.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4ZM10.2 10.2 13.5 13.5',
		filter: 'M2.5 3.5h11L9.5 8.5v4l-3 1.5V8.5Z',
		kalender: 'M3 4.5h10v8.5H3ZM3 7h10M5.5 3v2.5M10.5 3v2.5',
		person: 'M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3.2 13.2c.9-2.2 2.7-3.3 4.8-3.3s3.9 1.1 4.8 3.3'
	};
	const klasse = $derived([KLASSE[art], voll ? 'ui-voll' : '', klein ? 'klein' : '', (rest.class as string) ?? ''].filter(Boolean).join(' '));
</script>

{#snippet inhalt()}
	{#if symbol}
		<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"
			><path d={PFADE[symbol]} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg
		>
	{/if}
	{@render children()}
{/snippet}

{#if href}
	<a {...rest} {href} class={klasse}>{@render inhalt()}</a>
{:else}
	<button type="button" {...rest} class={klasse}>{@render inhalt()}</button>
{/if}
