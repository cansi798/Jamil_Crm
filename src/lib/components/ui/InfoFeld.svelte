<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoFenster from './InfoFenster.svelte';

	/**
	 * Feld mit ⓘ am Ende der Beschriftungszeile (Jamil msg 3423). Das ⓘ steht NEBEN dem <label>, nicht darin – sonst würde
	 * es den Namen des Feldes für Screenreader verfälschen. Aufbau: `<InfoFeld id="…"><label>Name <input /></label></InfoFeld>`.
	 */
	let { id, children }: { id: string; children: Snippet } = $props();
</script>

<div class="infofeld">
	{@render children()}
	<span class="infofeld-info"><InfoFenster {id} /></span>
</div>

<style>
	.infofeld {
		position: relative;
	}
	/* rechts oben auf der Höhe der Beschriftung; Platz dafür schafft der rechte Innenabstand des Labels */
	.infofeld-info {
		position: absolute;
		top: 0;
		right: 0;
		line-height: 0;
	}
	.infofeld > :global(label) {
		padding-right: 2.25rem;
	}
</style>
