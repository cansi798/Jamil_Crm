<script lang="ts">
	import '$lib/stil/kunden.css';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import MailVorlageEditor from '$lib/components/vorlagen/MailVorlageEditor.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Neue E-Mail-Vorlage – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<SeitenKopf titel="Neue E-Mail-Vorlage" zurueck={{ href: '/einstellungen/mail-vorlagen', text: 'E-Mail-Vorlagen' }} />
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	<MailVorlageEditor zweckVorgabe={data.zweck} werte={form?.werte ?? null} signatur={data.signatur} beispiele={data.beispiele} abbrechen="/einstellungen/mail-vorlagen" />
</main>
