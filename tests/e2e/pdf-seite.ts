import type { Page } from '@playwright/test';

/**
 * Rendert eine Seite eines PDFs als PNG (für Abnahme-Fotos). Chromium ohne Oberfläche zeigt PDFs nicht an; deshalb
 * zeichnet pdf.js (von cdnjs, nur in diesem Testwerkzeug) die Seite auf ein Canvas, das fotografiert wird.
 */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

export async function pdfSeiteAlsPng(seiteDerApp: Page, pdf: Uint8Array, pfad: string, seite = 1): Promise<void> {
	// Eigene leere Seite: Die Seiten der App erlauben per CSP keine fremden Skripte.
	const page = await seiteDerApp.context().newPage();
	await page.setViewportSize({ width: 1000, height: 1400 });
	await page.goto('about:blank');
	await page.setContent('<!doctype html><html><body style="margin:0;background:#888"><canvas id="c"></canvas></body></html>');
	await page.addScriptTag({ url: `${PDFJS}/pdf.min.js` });
	await page.evaluate(
		async ({ daten, seite, worker }) => {
			const lib = (window as any).pdfjsLib;
			lib.GlobalWorkerOptions.workerSrc = worker;
			const doc = await lib.getDocument({ data: new Uint8Array(daten) }).promise;
			const p = await doc.getPage(seite);
			const vp = p.getViewport({ scale: 1.6 });
			const c = document.getElementById('c') as HTMLCanvasElement;
			c.width = vp.width;
			c.height = vp.height;
			await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
		},
		{ daten: Array.from(pdf), seite, worker: `${PDFJS}/pdf.worker.min.js` }
	);
	await page.locator('#c').screenshot({ path: pfad });
	await page.close();
}
