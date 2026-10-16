<script lang="ts">
	import type { Symbol } from '$lib/navigation';

	/** Schlichte Linien-Symbole für die Navigation (24 × 24, Farbe aus `currentColor`). */
	let { symbol }: { symbol: Symbol | 'abmelden' } = $props();
</script>

<svg
	class="nav-symbol"
	viewBox="0 0 24 24"
	width="24"
	height="24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if symbol === 'start'}
		<path d="M3 11.5 12 4l9 7.5" />
		<path d="M5.5 10v10h13V10" />
		<path d="M10 20v-5h4v5" />
	{:else if symbol === 'kunden'}
		<circle cx="9" cy="8" r="3.5" />
		<path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
		<circle cx="17" cy="9" r="2.5" />
		<path d="M16.5 14c2.9.2 5 2.2 5 5" />
	{:else if symbol === 'auftraege'}
		<rect x="5" y="4" width="14" height="17" rx="2" />
		<path d="M9 4V2.8h6V4" />
		<path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
	{:else if symbol === 'todos'}
		<rect x="3.5" y="4" width="5" height="5" rx="1" />
		<path d="m4.8 6.5 1.2 1.2 2-2.2" />
		<path d="M11.5 6.5h9" />
		<rect x="3.5" y="14" width="5" height="5" rx="1" />
		<path d="M11.5 16.5h9" />
	{:else if symbol === 'abwesenheiten'}
		<rect x="3" y="5" width="18" height="16" rx="2" />
		<path d="M3 10h18M8 3v4M16 3v4" />
		<path d="m9.5 13.5 5 5M14.5 13.5l-5 5" />
	{:else if symbol === 'plantafel'}
		<rect x="3" y="5" width="18" height="16" rx="2" />
		<path d="M3 10h18M8 3v4M16 3v4" />
	{:else if symbol === 'benutzer'}
		<circle cx="12" cy="8" r="4" />
		<path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
	{:else if symbol === 'rollen'}
		<path d="M12 3 20 6v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z" />
		<path d="m9 12 2 2 4-4" />
	{:else if symbol === 'admin'}
		<rect x="3" y="3" width="7" height="7" rx="1" />
		<rect x="14" y="3" width="7" height="7" rx="1" />
		<rect x="3" y="14" width="7" height="7" rx="1" />
		<rect x="14" y="14" width="7" height="7" rx="1" />
	{:else if symbol === 'abmelden'}
		<path d="M14 4h5v16h-5" />
		<path d="M10 8 6 12l4 4M6 12h11" />
	{:else}
		<circle cx="5" cy="12" r="1.5" />
		<circle cx="12" cy="12" r="1.5" />
		<circle cx="19" cy="12" r="1.5" />
	{/if}
</svg>

<style>
	.nav-symbol {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
	}
</style>
