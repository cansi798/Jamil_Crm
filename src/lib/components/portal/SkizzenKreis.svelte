<script lang="ts">
	/**
	 * Handgezeichneter Kreis wie auf der Bauwelt-Website (Plaketten und Ringe, msg 2953): zwei leicht versetzte,
	 * unrunde Striche – aus einem festen Startwert, damit jeder Kreis anders, aber bei jedem Laden gleich aussieht.
	 * `art="plakette"` gefüllt in der Hausfarbe (Inhalt kommt vom Aufrufer), `art="ring"` nur Strich. Zeichnet sich
	 * einmal nach; bei „Bewegung reduzieren“ steht er sofort.
	 */
	import type { Snippet } from 'svelte';
	let { art = 'ring', groesse = 48, seed = 3, children }: { art?: 'plakette' | 'ring'; groesse?: number; seed?: number; children?: Snippet } = $props();

	function zufall(n: number) {
		const x = Math.sin(n * 9301 + seed * 49297) * 233280;
		return x - Math.floor(x);
	}
	/** unrunder Kreis als Pfad: Radius schwankt leicht, Anfang und Ende überlappen wie mit dem Stift gezogen */
	function strich(versatz: number): string {
		const c = 50;
		const r = 40 + versatz;
		const start = zufall(versatz + 1) * Math.PI * 2;
		const schritte = 40;
		const pkt: string[] = [];
		for (let i = 0; i <= schritte; i++) {
			const t = start + (i / schritte) * Math.PI * 2.12;
			const rr = r * (1 + 0.035 * Math.sin(3 * t + seed) + 0.02 * (zufall(i + versatz * 7) - 0.5));
			pkt.push(`${(c + rr * Math.cos(t)).toFixed(2)} ${(c + rr * Math.sin(t) * 0.97).toFixed(2)}`);
		}
		return `M ${pkt.join(' L ')}`;
	}
	const a = $derived(strich(0));
	const b = $derived(strich(1.6));
</script>

<span class={`sk sk-${art}`} style:width={`${groesse}px`} style:height={`${groesse}px`}>
	<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
		{#if art === 'plakette'}<path class="sk-flaeche" d={a} />{/if}
		<path class="sk-strich" d={a} pathLength="1" />
		<path class="sk-strich zwei" d={b} pathLength="1" />
	</svg>
	{#if children}<span class="sk-inhalt">{@render children()}</span>{/if}
</span>

<style>
	.sk {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.sk-flaeche {
		fill: var(--ui-akzent);
		opacity: 0;
		animation: sk-auf 0.3s 0.45s ease-out forwards;
	}
	.sk-strich {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 3.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: sk-zeichnen 0.6s 0.1s ease-out forwards;
	}
	.sk-plakette .sk-strich {
		stroke: var(--ui-akzent-text);
	}
	.zwei {
		stroke-width: 1.8;
		opacity: 0.6;
		animation-delay: 0.35s;
	}
	.sk-inhalt {
		position: relative;
		font-family: var(--pt-titel, var(--ui-schrift-titel));
		font-weight: 800;
		line-height: 1;
	}
	.sk-plakette .sk-inhalt {
		color: var(--ui-akzent-auf);
	}
	@keyframes sk-zeichnen {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes sk-auf {
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk-strich,
		.sk-flaeche {
			animation: none;
			stroke-dashoffset: 0;
			opacity: 1;
		}
		.zwei {
			opacity: 0.6;
		}
	}
</style>
