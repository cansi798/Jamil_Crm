<script lang="ts" module>
	/**
	 * Unrunder Kreis wie SkizzenKreis/Bauwelt-Website: zwei leicht versetzte Striche, Anfang und Ende überlappen wie
	 * mit dem Stift gezogen. Fester Startwert → bei jedem Laden gleich; einmal pro Modul berechnet.
	 */
	function zufall(n: number) {
		const x = Math.sin(n * 9301 + 5 * 49297) * 233280;
		return x - Math.floor(x);
	}
	function ring(versatz: number): string {
		const start = zufall(versatz + 1) * Math.PI * 2;
		const pkt: string[] = [];
		for (let i = 0; i <= 36; i++) {
			const t = start + (i / 36) * Math.PI * 2.1;
			const r = (44 + versatz * 0.6) * (1 + 0.025 * Math.sin(3 * t + 5) + 0.015 * (zufall(i + versatz * 7) - 0.5));
			pkt.push(`${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t) * 0.98).toFixed(1)}`);
		}
		return `M${pkt.join('L')}`;
	}
	const RING_A = ring(0);
	const RING_B = ring(1.4);

	// Grundformen (Kopf-Schulter-Büste, 100 × 100), leicht unregelmäßig wie von Hand
	const KOERPER = 'M12 104C13 85 22 75 39 70.5L50 72.5 61.5 70C78 74.5 87 85 88.5 104Z';
	const KOPF = 'M50 30C60 29.5 66.5 37 66 47.5 65.5 57.5 59 64.5 50 64.2 41 64 34.2 57.5 34 47 33.8 37 40 30.3 50 30Z';
	const HAAR_HINTEN = 'M33 44C30 56 31 65 35.5 71L64.5 71C69 65 70 56 67 44 65.5 31 59 25 50 25 41 25 34.5 31 33 44Z';
	const HELM = 'M30.5 39C30 25 39 18.5 50 18.2 61 18 70 24.5 69.5 39Z';
	const KREMPE = 'M26.5 39.5Q50 35.5 73.5 39.2 75 42.2 71 42.4L29 42.6Q25.5 42.5 26.5 39.5Z';
</script>

<script lang="ts">
	/**
	 * Gezeichnete Comic-Figur statt Anfangsbuchstaben im Kundenportal (Jamil msg 3113) – im Stil der Bauwelt-Website
	 * (Team-Zeichnung): Anthrazit-Linien mit doppeltem Strich, Jacke/Krawatte/Helm in der Hausfarbe (`--ui-akzent`,
	 * passt sich je Betrieb an), runder handgezeichneter Rahmen. Vier Figuren: Projektbegleiter(in) mit Hemd, Sakko und
	 * Klemmbrett; Monteur(in) mit Bauhelm, Arbeitsjacke und Hammer. Welche Figur: `figurFuer` in `$lib/portal-figur`.
	 * Nur fürs Portal – die Avatare in der App bleiben Initialen.
	 */
	import { FIGUR_NAMEN, type Figur } from '$lib/portal-figur';

	let { figur, groesse = 56, name = '' }: { figur: Figur; groesse?: number; name?: string | null } = $props();

	const uid = $props.id();
	const frau = $derived(figur === 'projektbegleiterin' || figur === 'monteurin');
	const monteur = $derived(figur === 'monteur' || figur === 'monteurin');
	const label = $derived(name ? `${name}, ${FIGUR_NAMEN[figur]}` : FIGUR_NAMEN[figur]);
</script>

{#snippet doppelt(d: string, klasse: string)}
	<path class={klasse} {d} />
	<path class="nach" {d} transform="translate(1 -0.8)" />
{/snippet}

<span class="pf" data-figur={figur} style:width={`${groesse}px`} style:height={`${groesse}px`} role="img" aria-label={label}>
	<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
		<defs>
			<clipPath id={`${uid}-k`}><circle cx="50" cy="50" r="43" /></clipPath>
			<pattern id={`${uid}-j`} width="5.5" height="5.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
				<rect class="j-grund" width="5.5" height="5.5" /><line class="j-strich" x1="0" y1="0" x2="0" y2="5.5" />
			</pattern>
			<pattern id={`${uid}-h`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
				<rect class="h-grund" width="4" height="4" /><line class="h-strich" x1="0" y1="0" x2="0" y2="4" />
			</pattern>
		</defs>
		<circle class="grund" cx="50" cy="50" r="43" />
		<g clip-path={`url(#${uid}-k)`}>
			<g transform="translate(50 47) scale(1.1) translate(-50 -50)">
			{#if frau}<path class="l" d={HAAR_HINTEN} fill={`url(#${uid}-h)`} />{/if}
			<!-- Körper: Monteur Arbeitsjacke (schraffiert), Büro Sakko mit Hemd -->
			{#if monteur}
				<path class="l" d={KOERPER} fill={`url(#${uid}-j)`} />
				{@render doppelt(KOERPER, 'l')}
				<path class="d" d="M50 73V104" />
				<path class="l fl" d="M40 70.5 46 79 50 73 54 79 60 70.5" />
				<path class="d fl" d="M56 84h10.5l-.6 8H56.4Z" />
			{:else}
				<path class="sakko" d={KOERPER} />
				{@render doppelt(KOERPER, 'l')}
				<path class="hemd l" d="M41.5 71 50 95 58.5 70.5Z" />
				{#if frau}
					<path class="l fl" d="M42 71Q45.5 78.5 50 74.5 54.5 78.5 58 70.8" />
					<path class="kette" d="M44 73.5Q50 82 56 73.3" />
					<circle class="akzent" cx="50" cy="80.6" r="2.2" />
				{:else}
					<path class="l fl" d="M41.5 71 46.5 78.5 50 73.5 53.5 78.5 58.5 70.8" />
					<path class="akzent l" d="M48.2 75.5h3.6l1.6 13.5-3.4 4-3.4-4Z" />
				{/if}
			{/if}
			<!-- Hals, Ohren, Kopf -->
			<path class="l" d="M44.5 62.5 44 71.5M55.5 62.5 56 71.5" />
			<ellipse class="haut l" cx="34.5" cy="48.5" rx="3.6" ry="5.2" />
			<ellipse class="haut l" cx="65.5" cy="48.5" rx="3.6" ry="5.2" />
			<path class="haut" d={KOPF} />
			{@render doppelt(KOPF, 'l')}
			<!-- Gesicht: Augen, Brauen, Nase, Lächeln, Wangen in der Hausfarbe -->
			<circle class="wange" cx="39.5" cy="54.5" r="4" />
			<circle class="wange" cx="60.5" cy="54.5" r="4" />
			<circle class="auge" cx="44" cy="47.5" r="2.3" />
			<circle class="auge" cx="56" cy="47.5" r="2.3" />
			<path class="d" d="M40.5 42.8Q44 40.6 47.5 42.6M52.5 42.6Q56 40.6 59.5 42.8" />
			{#if frau}<path class="d" d="M41.2 46.3 39.6 45.2M58.8 46.3 60.4 45.2" />{/if}
			<path class="d" d="M50.6 48.8Q48.4 52.5 51 53" />
			<path class="l" d="M44 56.2Q50 61.8 56 56.2" />
			<!-- Haare bzw. Helm -->
			{#if monteur}
				<path class="akzent" d={HELM} />
				{@render doppelt(HELM, 'l')}
				<path class="l" d="M50 18.5V37" />
				<path class="akzent" d={KREMPE} />
				{@render doppelt(KREMPE, 'l')}
			{:else if frau}
				<path class="l" d="M34.5 44C35 32 42 27.5 51 27.8 60 28.5 66 34 65.6 44 61 37 54 34.5 47 35 42.5 37.5 38 40.5 34.5 44Z" fill={`url(#${uid}-h)`} />
			{:else}
				<path class="l" d="M34.3 44.5C32.5 31.5 42 27 51 27.2 61 27.5 67.5 33 65.8 44.5 62 37 54 35.2 45.5 35.8 40.5 37.5 37 40.5 34.3 44.5Z" fill={`url(#${uid}-h)`} />
			{/if}
			<!-- Werkzeug: Klemmbrett (Büro) bzw. Hammer (Monteur) -->
			{#if monteur}
				<path class="stiel" d="M64 94 75.5 70" />
				<path class="l fl" d="M64 94 75.5 70" />
				<rect class="d dunkel" x="68.5" y="62" width="15" height="7" rx="1.6" transform="rotate(-27 76 65.5)" />
			{:else}
				<g transform="translate(-2 -4) rotate(7 64 78)">
					<rect class="papier l" x="55.5" y="67" width="17" height="22" rx="1.6" />
					<path class="nach" d="M55.5 67h17v22h-17Z" transform="translate(1 -0.8)" />
					<rect class="akzent l" x="60.5" y="64.8" width="7" height="4.6" rx="1.2" />
					<path class="d linien" d="M58.5 74.5h11M58.5 79h11M58.5 83.5h7" />
				</g>
				<ellipse class="haut l" cx="54" cy="80" rx="3.6" ry="4.4" />
			{/if}
			</g>
		</g>
		<path class="ring" d={RING_A} />
		<path class="ring zwei" d={RING_B} />
	</svg>
</span>

<style>
	.pf {
		position: relative;
		display: inline-block;
		flex: none;
		--pf-linie: var(--ui-anthrazit-900, #1f1e20);
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.grund {
		fill: var(--ui-akzent-hell, #f5f1e8);
	}
	path,
	ellipse,
	rect,
	circle {
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.l {
		stroke: var(--pf-linie);
		stroke-width: 2.6;
	}
	path.l:not([fill]):not(.akzent):not(.hemd) {
		fill: none;
	}
	.fl {
		fill: none;
		stroke-width: 2;
	}
	.d {
		fill: none;
		stroke: var(--pf-linie);
		stroke-width: 1.8;
	}
	/* zweiter, feiner Strich leicht versetzt – der „Skizzen“-Look */
	.nach {
		fill: none;
		stroke: var(--pf-linie);
		stroke-width: 1.1;
		opacity: 0.45;
	}
	.haut,
	.papier,
	.hemd {
		fill: #fff;
	}
	.sakko {
		fill: var(--ui-akzent-zart, #fbf9f5);
	}
	.akzent {
		fill: var(--ui-akzent);
	}
	.dunkel {
		fill: var(--pf-linie);
	}
	.kette {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 1.6;
	}
	.wange {
		fill: var(--ui-akzent);
		opacity: 0.32;
	}
	.auge {
		fill: var(--pf-linie);
	}
	.stiel {
		fill: none;
		stroke: #b98a52;
		stroke-width: 5;
	}
	.linien {
		stroke-width: 1.5;
		opacity: 0.7;
	}
	.j-grund {
		fill: var(--ui-akzent-hell, #f5f1e8);
	}
	.j-strich {
		stroke: var(--ui-akzent);
		stroke-width: 2.4;
	}
	.h-grund {
		fill: #fff;
	}
	.h-strich {
		stroke: var(--pf-linie);
		stroke-width: 2.2;
	}
	.ring {
		fill: none;
		stroke: var(--ui-akzent);
		stroke-width: 3.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.zwei {
		stroke-width: 1.8;
		opacity: 0.6;
	}
</style>
