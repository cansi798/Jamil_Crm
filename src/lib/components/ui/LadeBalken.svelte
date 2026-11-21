<script lang="ts">
	/**
	 * Schmaler Ladebalken oben, solange ein Seitenwechsel lädt (z. B. Tipp auf einen Menüpunkt bei schwachem Netz auf der
	 * Baustelle). Erst nach 150 ms sichtbar – schnelle Wechsel flackern nicht. Farbe: Hausfarbe (--ui-primaer).
	 */
	import { navigating } from '$app/state';

	let sichtbar = $state(false);
	$effect(() => {
		if (!navigating.to) {
			sichtbar = false;
			return;
		}
		const t = setTimeout(() => (sichtbar = true), 150);
		return () => clearTimeout(t);
	});
</script>

{#if sichtbar}
	<div class="lade-balken" role="progressbar" aria-label="Seite wird geladen"><span></span></div>
{/if}

<style>
	.lade-balken {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 2000;
		height: 3px;
		overflow: hidden;
		pointer-events: none;
		background: var(--ui-akzent-zart, transparent);
	}
	.lade-balken span {
		display: block;
		width: 40%;
		height: 100%;
		border-radius: 0 3px 3px 0;
		background: var(--ui-primaer, #c3a56f);
		animation: lade-lauf 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	@keyframes lade-lauf {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(260%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.lade-balken span {
			width: 100%;
			animation: none;
			opacity: 0.6;
		}
	}
</style>
