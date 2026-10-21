<script lang="ts">
	import { tagKurz } from '$lib/zeit';
	import { stufeName } from '$lib/stufen';

	/**
	 * Arbeitsschritte im Kundenportal (Jamil msg 2848): erledigt/offen mit Haken, die sich beim Öffnen nacheinander
	 * sichtbar setzen, und je Schritt Lautstärke und Schmutz (gering/mittel/hoch) mit freundlichen Symbolen – damit
	 * der Kunde planen kann (z. B. Homeoffice an lauten Tagen woanders).
	 */
	type Schritt = { titel: string; erledigt: boolean; tag: string | null; laerm: number | null; schmutz: number | null };
	let { schritte }: { schritte: Schritt[] } = $props();

	const fertig = $derived(schritte.filter((s) => s.erledigt).length);
	const prozent = $derived(schritte.length ? Math.round((fertig / schritte.length) * 100) : 0);
	const STUFE_TON = ['', 'gering', 'mittel', 'hoch'];
</script>

<div class="ps">
	<div class="ps-kopf">
		<span class="ps-zahl"><strong>{fertig}</strong> von {schritte.length} Schritten erledigt</span>
		<span class="ps-bahn" aria-hidden="true"><span style:--ziel={`${prozent}%`}></span></span>
	</div>
	<ol class="ps-liste">
		{#each schritte as s, i (i)}
			<li class:erledigt={s.erledigt} style:--verz={`${0.3 + i * 0.12}s`}>
				<span class="ps-haken" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="10" />
						{#if s.erledigt}<path d="M7 12.5l3.4 3.6L17.5 8.5" pathLength="1" />{/if}
					</svg>
				</span>
				<span class="ps-text">
					<span class="ps-titel">{s.titel}<span class="unsichtbar"> – {s.erledigt ? 'erledigt' : 'offen'}</span></span>
					{#if s.tag}<span class="ps-tag">{s.erledigt ? 'erledigt' : 'geplant'} · {tagKurz(s.tag)}</span>{/if}
				</span>
				<span class="ps-pegel">
					{#if s.laerm}
						<span class={`ps-chip ${STUFE_TON[s.laerm]}`} title={`Lautstärke: ${stufeName(s.laerm)}`}>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path class="ps-lautsprecher" d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
								{#each Array.from({ length: s.laerm }, (_, k) => k) as k (k)}
									<path class="ps-welle" style:--w={`${k * 0.25}s`} d={`M${15 + k * 2.6} ${9 - k * 1.6}q${2 + k} ${3 + k * 1.6} 0 ${6 + k * 3.2}`} />
								{/each}
							</svg>
							<span>Lautstärke {stufeName(s.laerm)}</span>
						</span>
					{/if}
					{#if s.schmutz}
						<span class={`ps-chip ${STUFE_TON[s.schmutz]}`} title={`Schmutz: ${stufeName(s.schmutz)}`}>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path class="ps-wolke" d="M6.5 17.5a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.8-1.2 3.9 3.9 0 0 1 1.8 7.6z" />
								{#each Array.from({ length: s.schmutz }, (_, k) => k) as k (k)}
									<circle class="ps-staub" style:--w={`${k * 0.3}s`} cx={8 + k * 4} cy="20.5" r="1.3" />
								{/each}
							</svg>
							<span>Schmutz {stufeName(s.schmutz)}</span>
						</span>
					{/if}
				</span>
			</li>
		{/each}
	</ol>
</div>

<style>
	.ps {
		display: grid;
		gap: 0.75rem;
	}
	.ps-kopf {
		display: grid;
		gap: 0.4rem;
	}
	.ps-zahl {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.ps-zahl strong {
		color: var(--ui-text);
		font-family: var(--ui-schrift-titel);
		font-size: 1.1rem;
	}
	.ps-bahn {
		display: block;
		height: 0.55rem;
		border-radius: 999px;
		background: var(--ui-grau-hell);
		overflow: hidden;
	}
	.ps-bahn span {
		display: block;
		height: 100%;
		width: var(--ziel);
		border-radius: 999px;
		background: var(--ui-akzent);
		animation: ps-wachsen 1.2s 0.3s cubic-bezier(0.45, 0, 0.2, 1) both;
	}
	.ps-liste {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ps-liste li {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.25rem 0.75rem;
		padding: 0.65rem 0;
		border-bottom: 1px dashed var(--ui-rand);
		animation: ps-rein 0.4s var(--verz) ease-out both;
	}
	.ps-liste li:last-child {
		border-bottom: 0;
	}
	.ps-haken svg {
		width: 1.75rem;
		height: 1.75rem;
		display: block;
	}
	.ps-haken circle {
		fill: var(--ui-flaeche);
		stroke: var(--ui-rand-stark);
		stroke-width: 1.8;
		transition: fill 0.3s;
	}
	.erledigt .ps-haken circle {
		fill: var(--ui-akzent);
		stroke: var(--ui-akzent);
		animation: ps-fuellen 0.3s calc(var(--verz) + 0.25s) ease-out both;
	}
	.ps-haken path {
		fill: none;
		stroke: var(--ui-akzent-auf);
		stroke-width: 2.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: ps-zeichnen 0.4s calc(var(--verz) + 0.45s) ease-out forwards;
	}
	.ps-text {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}
	.ps-titel {
		font-weight: 600;
	}
	.erledigt .ps-titel {
		color: var(--ui-text-leise);
		text-decoration: line-through;
		text-decoration-color: var(--ui-akzent);
		text-decoration-thickness: 2px;
	}
	.ps-tag {
		font-size: var(--ui-schrift-xs);
		color: var(--ui-text-leise);
	}
	.ps-pegel {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem;
	}
	@media (max-width: 640px) {
		.ps-liste li {
			grid-template-columns: 2rem minmax(0, 1fr);
		}
		.ps-pegel {
			grid-column: 2;
			justify-content: flex-start;
		}
	}
	.ps-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem 0.2rem 0.35rem;
		border-radius: 999px;
		font-size: var(--ui-schrift-xs);
		font-weight: 600;
		white-space: nowrap;
		--ton: var(--ui-gruen);
		background: color-mix(in srgb, var(--ton) 12%, white);
		color: color-mix(in srgb, var(--ton) 80%, black);
	}
	.ps-chip.mittel {
		--ton: var(--ui-orange);
	}
	.ps-chip.hoch {
		--ton: var(--ui-rot);
	}
	.ps-chip svg {
		width: 1.2rem;
		height: 1.2rem;
	}
	.ps-lautsprecher,
	.ps-wolke {
		fill: currentColor;
		opacity: 0.85;
	}
	.ps-welle {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		animation: ps-schall 1.8s var(--w) ease-in-out infinite;
	}
	.ps-staub {
		fill: currentColor;
		animation: ps-rieseln 2.2s var(--w) ease-in-out infinite;
	}
	.erledigt .ps-welle,
	.erledigt .ps-staub {
		animation: none;
	}
	@keyframes ps-rein {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@keyframes ps-fuellen {
		from {
			fill: var(--ui-flaeche);
			stroke: var(--ui-rand-stark);
		}
	}
	@keyframes ps-zeichnen {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes ps-wachsen {
		from {
			width: 0;
		}
	}
	@keyframes ps-schall {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
	@keyframes ps-rieseln {
		0%,
		100% {
			transform: translateY(0);
			opacity: 1;
		}
		50% {
			transform: translateY(-1.5px);
			opacity: 0.4;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ps-liste li,
		.ps-bahn span,
		.erledigt .ps-haken circle,
		.ps-welle,
		.ps-staub {
			animation: none;
		}
		.ps-haken path {
			animation: none;
			stroke-dashoffset: 0;
		}
	}
</style>
