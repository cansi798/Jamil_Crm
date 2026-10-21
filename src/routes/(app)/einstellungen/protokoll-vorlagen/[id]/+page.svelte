<script lang="ts">
	import '$lib/stil/kunden.css';
	import FormularVorlageBaukasten from '$lib/components/vorlagen/FormularVorlageBaukasten.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

{#key data.vorlage.id}
	<FormularVorlageBaukasten {data} {form} />
{/key}
