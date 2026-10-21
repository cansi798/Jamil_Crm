<script lang="ts">
	import { enhance } from '$app/forms';
	import Knopf from '$lib/components/ui/Knopf.svelte';

	/**
	 * Aktion einer Vorlagen-Zeile (Duplizieren, Archivieren, Wiederherstellen, Als Standard, Kopieren): Formular an eine
	 * Server-Aktion mit der ID – überall derselbe umrandete, klar klickbare Knopf mit Symbol (Jamil msg 3084: nicht blass).
	 * Löschen gehört NICHT hierher, sondern mit Rückfrage oben rechts auf die Detailseite (msgs 3043, 3091).
	 */
	type Symbol = 'kopieren' | 'archiv' | 'wiederherstellen' | 'stern';
	let { aktion, id, symbol, children }: { aktion: string; id: string; symbol: Symbol; children: import('svelte').Snippet } = $props();
</script>

<form method="POST" action={aktion} use:enhance={() => async ({ update }) => update({ reset: false })}>
	<input type="hidden" name="id" value={id} />
	<Knopf type="submit" art="sekundaer" klein {symbol}>{@render children()}</Knopf>
</form>
