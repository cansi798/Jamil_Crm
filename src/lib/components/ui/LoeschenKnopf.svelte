<script lang="ts">
	/**
	 * „<Ding> löschen“ – steht IMMER oben rechts im Seitenkopf (`.seiten-aktionen`), Regel von Jamil (Talk msg 3043,
	 * docs/design-regeln.md). Klappt die Rückfrage `LoeschenPanel` direkt unter dem Kopf auf (gemeinsames `offen`).
	 */
	let {
		ding,
		offen = $bindable(false),
		label,
		ziel = 'loeschen-oben',
		klein = false
	}: {
		/** z. B. „Objekt“ → „Objekt löschen“ */
		ding: string;
		offen?: boolean;
		/** abweichender Text (selten, z. B. „Entwurf löschen“) */
		label?: string;
		/** id des zugehörigen `LoeschenPanel` (nur nötig, wenn eine Seite mehrere hat) */
		ziel?: string;
		klein?: boolean;
	} = $props();
</script>

<button type="button" class="kd-knopf gefahr" class:klein aria-expanded={offen} aria-controls={ziel} onclick={() => (offen = !offen)}>
	{label ?? `${ding} löschen`}
</button>
