<script lang="ts">
	/**
	 * „<Ding> löschen“ – steht IMMER oben rechts im Seitenkopf (`.seiten-aktionen`), Regel von Jamil (Talk msg 3043,
	 * docs/design-regeln.md). Klappt die Rückfrage `LoeschenPanel` direkt unter dem Kopf auf (gemeinsames `offen`).
	 */
	let {
		ding,
		offen = $bindable(false),
		label
	}: {
		/** z. B. „Objekt“ → „Objekt löschen“ */
		ding: string;
		offen?: boolean;
		/** abweichender Text (selten, z. B. „Entwurf löschen“) */
		label?: string;
	} = $props();
</script>

<button type="button" class="kd-knopf gefahr" aria-expanded={offen} aria-controls="loeschen-oben" onclick={() => (offen = !offen)}>
	{label ?? `${ding} löschen`}
</button>
