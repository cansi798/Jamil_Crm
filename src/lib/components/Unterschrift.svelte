<script lang="ts">
	/**
	 * Unterschrift-Komponente: HTML5 Canvas für Touch/Pointer-Events.zeichnet Linien auf dem Canvas (2px, schwarz,
	 * runde Kappen), „Löschen" setzt zurück, „Fertig" exportiert als PNG (Uint8Array). Responsive: Canvas füllt
	 * verfügbare Breite, Höhe 200px. `touch-action: none` verhindert Scrollen auf dem Handy.
	 */

	let { onunterschrift }: { onunterschrift: (png: Uint8Array) => void } = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let ctx: CanvasRenderingContext2D | null = null;
	let zeichnet = $state(false);
	let hatZeichnung = $state(false);

	function initCanvas() {
		if (!canvas) return;
		ctx = canvas.getContext('2d');
		if (!ctx) return;
		// Canvas-Größe setzen (CSS-Pixel × devicePixelRatio für schärfe)
		const breite = canvas.clientWidth;
		const hoehe = 200;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = breite * dpr;
		canvas.height = hoehe * dpr;
		canvas.style.width = `${breite}px`;
		canvas.style.height = `${hoehe}px`;
		ctx.scale(dpr, dpr);
		// weißer Hintergrund
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, breite, hoehe);
		// Linieneinstellungen
		ctx.strokeStyle = '#000';
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
	}

	function pointerDown(e: PointerEvent) {
		if (!ctx || !canvas) return;
		zeichnet = true;
		hatZeichnung = true;
		const rect = canvas.getBoundingClientRect();
		ctx.beginPath();
		ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
		canvas.setPointerCapture(e.pointerId);
	}

	function pointerMove(e: PointerEvent) {
		if (!zeichnet || !ctx || !canvas) return;
		const rect = canvas.getBoundingClientRect();
		ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
		ctx.stroke();
	}

	function pointerUp(e: PointerEvent) {
		if (!canvas) return;
		zeichnet = false;
		canvas.releasePointerCapture(e.pointerId);
	}

	function loeschen() {
		if (!canvas || !ctx) return;
		hatZeichnung = false;
		initCanvas();
	}

	async function fertig() {
		if (!canvas) return;
		const blob = await new Promise<Blob>((ok, fehler) => {
			canvas!.toBlob((b) => {
				if (b) ok(b);
				else fehler(new Error('Canvas toBlob fehlgeschlagen'));
			}, 'image/png');
		});
		const buffer = await blob.arrayBuffer();
		onunterschrift(new Uint8Array(buffer));
	}

	$effect(() => {
		initCanvas();
	});
</script>

<div class="unterschrift">
	<canvas
		bind:this={canvas}
		data-testid="unterschrift-canvas"
		style="touch-action: none; border: 1px solid #ccc; border-radius: 4px; cursor: crosshair;"
		onpointerdown={pointerDown}
		onpointermove={pointerMove}
		onpointerup={pointerUp}
		onpointercancel={pointerUp}
	></canvas>
	<div class="knopf-leiste">
		<button type="button" onclick={loeschen} disabled={!hatZeichnung}>Löschen</button>
		<button type="button" onclick={fertig} disabled={!hatZeichnung} data-testid="unterschrift-speichern">Fertig</button>
	</div>
</div>

<style>
	.unterschrift {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	canvas {
		width: 100%;
		height: 200px;
	}
	.knopf-leiste {
		display: flex;
		gap: 0.5rem;
	}
	button {
		padding: 0.5rem 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>