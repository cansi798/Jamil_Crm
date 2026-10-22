<script lang="ts">
	/**
	 * Fortschrittsweg im Kundenportal (Jamil msg 2848): handgezeichneter Weg von „Anfrage eingegangen“ bis „Projekt erfolgreich beendet“ (Namen: src/lib/portal-status.ts).
	 * Der erreichte Teil zeichnet sich beim Öffnen in der Hausfarbe nach, die aktuelle Station pulsiert leicht.
	 * Desktop waagerecht, Handy senkrecht. Bei „Bewegung reduzieren“ steht alles sofort da.
	 */
	let { stufen, aktuell }: { stufen: { schluessel: string; name: string }[]; aktuell: string } = $props();

	const idx = $derived(Math.max(0, stufen.findIndex((s) => s.schluessel === aktuell)));
	const n = $derived(stufen.length);

	// Waagerecht: Stationen auf einer leicht welligen Linie (fest „von Hand“ verschoben, damit es nicht wie ein Lineal wirkt)
	const W = 720;
	const H = 108;
	const WACKEL = [0, -6, 4, -3, 5, -2, 3, -4];
	const punkteW = $derived(stufen.map((_, i) => ({ x: 56 + (i * (W - 112)) / Math.max(1, n - 1), y: 34 + WACKEL[i % WACKEL.length] })));
	// Senkrecht (Handy)
	const ZEILE = 62;
	const punkteS = $derived(stufen.map((_, i) => ({ x: 22 + WACKEL[(i + 3) % WACKEL.length] * 0.8, y: 22 + i * ZEILE })));

	/**
	 * Beschriftung waagerecht in höchstens zwei ausgewogenen Zeilen (msg 3131: längere Kundentexte wie „Projekt
	 * erfolgreich beendet“ dürfen sich nicht überlappen).
	 */
	function zeilen(name: string): string[] {
		const w = name.split(' ');
		if (w.length < 2) return [name];
		let beste = [name];
		let max = Infinity;
		for (let i = 1; i < w.length; i++) {
			const z = [w.slice(0, i).join(' '), w.slice(i).join(' ')];
			const m = Math.max(z[0].length, z[1].length);
			if (m < max) [beste, max] = [z, m];
		}
		return beste;
	}

	/** Weg durch Punkte als geschwungene Kurven; `bis` = letzter Punkt (einschließlich). */
	function weg(p: { x: number; y: number }[], bis: number, senkrecht: boolean): string {
		if (p.length === 0) return '';
		let d = `M ${p[0].x} ${p[0].y}`;
		for (let i = 1; i <= Math.min(bis, p.length - 1); i++) {
			const a = p[i - 1];
			const b = p[i];
			const bogen = i % 2 === 0 ? 10 : -10;
			const cx = senkrecht ? (a.x + b.x) / 2 + bogen : (a.x + b.x) / 2;
			const cy = senkrecht ? (a.y + b.y) / 2 : (a.y + b.y) / 2 + bogen;
			d += ` Q ${cx} ${cy} ${b.x} ${b.y}`;
		}
		return d;
	}
</script>

<div class="fw" role="img" aria-label={`Fortschritt: ${stufen[idx]?.name ?? ''} (Schritt ${idx + 1} von ${n})`}>
	<!-- Bleistift-Wackeln für Linien und Kreise; eigenes, immer sichtbares SVG (Filter in display:none-SVGs greifen nicht überall) -->
	<svg class="fw-defs" width="0" height="0" aria-hidden="true">
		<filter id="fw-skizze" x="-5%" y="-30%" width="110%" height="160%">
			<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
			<feDisplacementMap in="SourceGraphic" scale="2.6" />
		</filter>
	</svg>
	<svg class="fw-quer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
		<path class="fw-grund" d={weg(punkteW, n - 1, false)} filter="url(#fw-skizze)" />
		{#if idx > 0}<path class="fw-erreicht" d={weg(punkteW, idx, false)} pathLength="1" filter="url(#fw-skizze)" />{/if}
		{#each punkteW as p, i (i)}
			<g class="fw-station" class:erreicht={i < idx} class:jetzt={i === idx} style:--verz={`${0.25 + (i / Math.max(1, n - 1)) * 1.1}s`}>
				{#if i === idx}<circle class="fw-puls" cx={p.x} cy={p.y} r="15" />{/if}
				<circle class="fw-punkt" cx={p.x} cy={p.y} r="11" filter="url(#fw-skizze)" />
				{#if i < idx}<path class="fw-haken" d={`M ${p.x - 5} ${p.y} l 3.5 4 l 6.5 -8`} pathLength="1" />{/if}
				<text x={p.x} y={p.y + 34} text-anchor="middle">{#each zeilen(stufen[i].name) as z, j (j)}<tspan x={p.x} dy={j === 0 ? 0 : 15}>{z}</tspan>{/each}</text>
			</g>
		{/each}
	</svg>

	<svg class="fw-hoch" viewBox={`0 0 280 ${22 + (n - 1) * ZEILE + 22}`} aria-hidden="true">
		<path class="fw-grund" d={weg(punkteS, n - 1, true)} filter="url(#fw-skizze)" />
		{#if idx > 0}<path class="fw-erreicht" d={weg(punkteS, idx, true)} pathLength="1" filter="url(#fw-skizze)" />{/if}
		{#each punkteS as p, i (i)}
			<g class="fw-station" class:erreicht={i < idx} class:jetzt={i === idx} style:--verz={`${0.25 + (i / Math.max(1, n - 1)) * 1.1}s`}>
				{#if i === idx}<circle class="fw-puls" cx={p.x} cy={p.y} r="15" />{/if}
				<circle class="fw-punkt" cx={p.x} cy={p.y} r="11" filter="url(#fw-skizze)" />
				{#if i < idx}<path class="fw-haken" d={`M ${p.x - 5} ${p.y} l 3.5 4 l 6.5 -8`} pathLength="1" />{/if}
				<text x={p.x + 26} y={p.y + 5}>{stufen[i].name}</text>
			</g>
		{/each}
	</svg>
</div>

<style>
	.fw {
		width: 100%;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.fw-defs {
		position: absolute;
		width: 0;
		height: 0;
	}
	.fw-hoch {
		display: none;
		max-width: 17rem;
	}
	@media (max-width: 640px) {
		.fw-quer {
			display: none;
		}
		.fw-hoch {
			display: block;
		}
	}
	.fw-grund {
		fill: none;
		stroke: var(--ui-rand-stark);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-dasharray: 2 7;
	}
	.fw-erreicht {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 5;
		stroke-linecap: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: fw-zeichnen 1.4s 0.2s cubic-bezier(0.45, 0, 0.2, 1) forwards;
	}
	.fw-punkt {
		fill: var(--ui-flaeche);
		stroke: var(--ui-rand-stark);
		stroke-width: 2.5;
	}
	.fw-station.erreicht .fw-punkt {
		fill: var(--ui-akzent);
		stroke: var(--ui-akzent);
		opacity: 0;
		animation: fw-auf 0.35s var(--verz) ease-out forwards;
	}
	.fw-station.jetzt .fw-punkt {
		fill: var(--ui-flaeche);
		stroke: var(--ui-akzent);
		stroke-width: 4;
	}
	.fw-puls {
		fill: var(--ui-akzent);
		opacity: 0.18;
		transform-box: fill-box;
		transform-origin: center;
		animation: fw-puls 2.2s 1.6s ease-in-out infinite;
	}
	.fw-haken {
		fill: none;
		stroke: var(--ui-akzent-auf);
		stroke-width: 2.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: fw-zeichnen 0.35s calc(var(--verz) + 0.2s) ease-out forwards;
	}
	text {
		fill: var(--ui-text-leise);
		font-family: var(--ui-schrift-titel);
		font-size: 13px;
		font-weight: 600;
	}
	.fw-station.erreicht text {
		fill: var(--ui-text);
	}
	.fw-station.jetzt text {
		fill: var(--ui-akzent-text);
		font-weight: 800;
	}
	@keyframes fw-zeichnen {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes fw-auf {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes fw-puls {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.18;
		}
		50% {
			transform: scale(1.35);
			opacity: 0.05;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fw-erreicht,
		.fw-haken {
			animation: none;
			stroke-dashoffset: 0;
		}
		.fw-station.erreicht .fw-punkt {
			animation: none;
			opacity: 1;
		}
		.fw-puls {
			animation: none;
		}
	}
</style>
