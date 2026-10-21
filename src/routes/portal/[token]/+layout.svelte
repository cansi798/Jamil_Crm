<script lang="ts">
	import type { Snippet } from 'svelte';
	import PortalPasswort from '$lib/components/portal/PortalPasswort.svelte';
	import type { LayoutData } from './$types';

	/** Kundenportal: ohne Passwort nur die Abfrage (Jamil msg 3037), sonst die Portal-Seite. */
	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

{#if data.passwortNoetig}
	<PortalPasswort token={data.token} aussehen={data.aussehen} anmeldung={data.anmeldung} />
{:else}
	{@render children()}
{/if}
