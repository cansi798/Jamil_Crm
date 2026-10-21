<script lang="ts">
	import '$lib/stil/kunden.css';
	import FormularVorlagenListe from '$lib/components/vorlagen/FormularVorlagenListe.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<FormularVorlagenListe {data} {form} />
