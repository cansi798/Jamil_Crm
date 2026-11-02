<script lang="ts">
	import type { Kontaktweg } from '$lib/kontaktweg';

	/** Linien-Symbol je Kontaktweg (Umschlag, Sprechblase, Hörer) – 24er Raster, Farbe aus `currentColor`. */
	let { weg, groesse = 16 }: { weg: Kontaktweg | ''; groesse?: number } = $props();
</script>

<svg
	class="kw-symbol"
	viewBox="0 0 24 24"
	width={groesse}
	height={groesse}
	fill="none"
	stroke="currentColor"
	stroke-width="1.9"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if weg === 'email'}
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
	{:else if weg === 'chat'}
		<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z" />
		<path d="M8 9.5h8M8 12.5h5" />
	{:else if weg === 'telefon'}
		<path d="M6.6 3.5h2.6l1.4 4-2 1.4a11 11 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />
	{:else}
		<circle cx="12" cy="12" r="8" />
		<path d="M8.5 12h7" />
	{/if}
</svg>

<style>
	.kw-symbol {
		flex: 0 0 auto;
	}
</style>
