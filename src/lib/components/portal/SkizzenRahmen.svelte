<script lang="ts">
	/**
	 * Handgezeichneter Rahmen um eine Karte (Wunsch Jamil, msg 3040) – wie die Kreise der Bauwelt-Website
	 * (SkizzenKreis): zwei leicht versetzte, unrunde Striche in der Hausfarbe. Liegt absolut über dem Elternelement
	 * (das `position: relative` braucht), misst dessen Größe (ResizeObserver) und zeichnet den Pfad in Pixeln – so bleibt
	 * die Strichstärke bei jeder Kartengröße gleich. Kein Platzbedarf (kein Verschieben), keine Klicks (pointer-events:
	 * none). Zeichnet sich einmal nach, sobald die Karte sichtbar wird; danach läuft ein kräftigerer Stiftstrich
	 * ständig ruhig um die Karte herum (msg 3052: „in Bewegung, damit sie mehr auffällt“), der zweite Strich atmet leicht.
	 * Bei „Bewegung reduzieren“ steht der Rahmen sofort und ruhig (ohne laufenden Stift).
	 */
	let { seed = 7, abstand = 7 }: { seed?: number; abstand?: number } = $props();

	let wurzel = $state<HTMLSpanElement>();
	let b = $state(0);
	let h = $state(0);
	let sichtbar = $state(false);

	$effect(() => {
		const el = wurzel;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			b = el.clientWidth;
			h = el.clientHeight;
		});
		ro.observe(el);
		const io = new IntersectionObserver(
			(e) => {
				if (e.some((x) => x.isIntersecting)) {
					sichtbar = true;
					io.disconnect();
				}
			},
			{ threshold: 0.25 }
		);
		io.observe(el);
		return () => {
			ro.disconnect();
			io.disconnect();
		};
	});

	function zufall(n: number) {
		const x = Math.sin(n * 9301 + seed * 49297) * 233280;
		return x - Math.floor(x);
	}

	/**
	 * Unrundes Rechteck mit weichen Ecken: Punkte entlang des Umfangs, jeder leicht nach innen/außen verschoben;
	 * Anfang und Ende überlappen ein Stück wie mit dem Stift gezogen.
	 */
	function strich(versatz: number, w: number, hh: number): string {
		if (w < 20 || hh < 20) return '';
		const r = Math.min(22, w / 6, hh / 6);
		const x0 = 3 + versatz * 0.6;
		const y0 = 3 - versatz * 0.4;
		const x1 = w - 3 - versatz * 0.5;
		const y1 = hh - 3 + versatz * 0.3;
		// Stützpunkte im Uhrzeigersinn (Ecken als kurze Bögen aus 3 Punkten)
		const ecke = (cx: number, cy: number, von: number) =>
			[0, 0.5, 1].map((t) => {
				const a = von + (t * Math.PI) / 2;
				return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
			});
		const roh: number[][] = [
			...ecke(x0 + r, y0 + r, Math.PI),
			...ecke(x1 - r, y0 + r, -Math.PI / 2),
			...ecke(x1 - r, y1 - r, 0),
			...ecke(x0 + r, y1 - r, Math.PI / 2)
		];
		// lange Seiten in Zwischenpunkte teilen, damit der Strich leicht wellt
		const pkt: number[][] = [];
		for (let i = 0; i < roh.length; i++) {
			const [ax, ay] = roh[i];
			const [bx, by] = roh[(i + 1) % roh.length];
			const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 70));
			for (let j = 0; j < n; j++) pkt.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
		}
		const zitter = (i: number) => (zufall(i * 3.1 + versatz * 11) - 0.5) * 2.6;
		const p = pkt.map(([x, y], i) => [x + zitter(i), y + zitter(i + 50)]);
		// Überlappung: die ersten Punkte noch einmal, leicht nach innen versetzt
		const extra = p.slice(0, 3).map(([x, y]) => [x + 1.5, y + 2]);
		const alle = [...p, ...extra];
		// weiche Kurve durch die Punkte (Mittelpunkte als Ankerpunkte)
		let d = `M ${alle[0][0].toFixed(1)} ${alle[0][1].toFixed(1)}`;
		for (let i = 1; i < alle.length - 1; i++) {
			const mx = (alle[i][0] + alle[i + 1][0]) / 2;
			const my = (alle[i][1] + alle[i + 1][1]) / 2;
			d += ` Q ${alle[i][0].toFixed(1)} ${alle[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
		}
		const z = alle[alle.length - 1];
		return `${d} L ${z[0].toFixed(1)} ${z[1].toFixed(1)}`;
	}
	const a = $derived(strich(0, b, h));
	const zwei = $derived(strich(2.2, b, h));
</script>

<span class="sr" class:sichtbar bind:this={wurzel} style:--sr-abstand={`${-abstand}px`} aria-hidden="true">
	{#if a}
		<svg width={b} height={h} viewBox={`0 0 ${b} ${h}`} focusable="false">
			<path class="sr-strich" d={a} pathLength="1" />
			<path class="sr-strich zwei" d={zwei} pathLength="1" />
			<!-- Stift, der ständig um die Karte läuft (msg 3052) -->
			<path class="sr-stift" d={a} pathLength="1" />
		</svg>
	{/if}
</span>

<style>
	.sr {
		position: absolute;
		inset: var(--sr-abstand);
		pointer-events: none;
		z-index: 1;
	}
	svg {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.sr-strich {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 2.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
	}
	.zwei {
		stroke-width: 1.4;
		opacity: 0.55;
	}
	.sichtbar .sr-strich {
		animation: sr-zeichnen 1.1s 0.15s ease-out forwards;
	}
	.sichtbar .zwei {
		animation:
			sr-zeichnen 1.1s 0.55s ease-out forwards,
			sr-atmen 3.5s 1.8s ease-in-out infinite;
	}
	/* laufender Stift: ein kurzes, kräftigeres Stück Strich, das gleichmäßig um die Karte wandert */
	.sr-stift {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 4.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 0.16 0.84;
		stroke-dashoffset: 0;
		opacity: 0;
	}
	.sichtbar .sr-stift {
		animation:
			sr-auf 0.4s 1.3s ease-out forwards,
			sr-laufen 4.5s 1.3s linear infinite;
	}
	@keyframes sr-zeichnen {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes sr-laufen {
		from {
			stroke-dashoffset: 0;
		}
		to {
			stroke-dashoffset: -1;
		}
	}
	@keyframes sr-auf {
		to {
			opacity: 0.85;
		}
	}
	@keyframes sr-atmen {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 0.25;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sr-strich,
		.sichtbar .sr-strich,
		.sichtbar .zwei {
			animation: none;
			stroke-dashoffset: 0;
		}
		.sr-stift,
		.sichtbar .sr-stift {
			animation: none;
			display: none;
		}
	}
</style>
