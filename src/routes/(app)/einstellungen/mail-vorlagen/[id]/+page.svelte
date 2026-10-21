<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import Knopf from '$lib/components/ui/Knopf.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import MailVorlageEditor from '$lib/components/vorlagen/MailVorlageEditor.svelte';
	import { ZWECK_NAMEN } from '$lib/mail-vorlagen';
	import type { ActionData, PageData } from './$types';

	/** Eine E-Mail-Vorlage – Detailseite wie bei allen Vorlagen (Jamil msgs 3084, 3086); Löschen oben rechts mit Rückfrage. */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loeschenOffen = $state(false);
	const loeschFehler = $derived(form && 'loeschFehler' in form && form.loeschFehler ? (form.fehler ?? null) : null);
	const werte = $derived(form && 'werte' in form && 'fehler' in form ? (form.werte as Record<string, string>) : null);
</script>

<svelte:head>
	<title>{data.vorlage.name} – E-Mail-Vorlage</title>
</svelte:head>

<main class="kd-seite breit">
	<SeitenKopf
		ueberzeile="E-Mail-Vorlage"
		titel={data.vorlage.name}
		meta={`${ZWECK_NAMEN[data.vorlage.zweck]}${data.vorlage.istStandard ? ' · Standard' : ''}`}
		zurueck={{ href: '/einstellungen/mail-vorlagen', text: 'E-Mail-Vorlagen' }}
	>
		{#snippet aktionen()}
			{#if !data.vorlage.istStandard}
				<form method="POST" action="?/standard" use:enhance={() => async ({ update }) => update({ reset: false })}>
					<Knopf type="submit" art="sekundaer" symbol="stern">Als Standard</Knopf>
				</form>
			{/if}
			<form method="POST" action="?/kopieren" use:enhance>
				<Knopf type="submit" art="sekundaer" symbol="kopieren">Kopieren</Knopf>
			</form>
			<LoeschenKnopf ding="Vorlage" bind:offen={loeschenOffen} />
		{/snippet}
	</SeitenKopf>
	<LoeschenPanel ding="Vorlage" bind:offen={loeschenOffen} fehler={loeschFehler}>
		Die E-Mail-Vorlage „{data.vorlage.name}“ wird endgültig gelöscht.{data.vorlage.istStandard ? ' Sie ist Standard – eine andere Vorlage dieses Zwecks wird dann Standard.' : ''}
	</LoeschenPanel>

	{#if form && 'fehler' in form && !loeschFehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form && 'gespeichert' in form}<p role="status" class="mv-ok">Gespeichert.</p>{:else if data.angelegt}<p role="status" class="mv-ok">Vorlage angelegt.</p>{/if}

	{#key data.vorlage.id}
		<MailVorlageEditor vorlage={data.vorlage} {werte} signatur={data.signatur} beispiele={data.beispiele} abbrechen="/einstellungen/mail-vorlagen" />
	{/key}
</main>

<style>
	.mv-ok {
		margin: 0 0 var(--ui-a3);
		color: var(--ui-gruen);
		font-weight: 600;
	}
</style>
