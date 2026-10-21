<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import MailVorschau from '$lib/components/MailVorschau.svelte';
	import VorlagenKopf from '$lib/components/vorlagen/VorlagenKopf.svelte';
	import VorlagenListe from '$lib/components/vorlagen/VorlagenListe.svelte';
	import ZeilenAktion from '$lib/components/vorlagen/ZeilenAktion.svelte';
	import { MAIL_ZWECKE, ZWECK_HINWEIS, ZWECK_NAMEN } from '$lib/mail-vorlagen';
	import type { ActionData, PageData } from './$types';

	/**
	 * E-Mail-Vorlagen (Jamil msgs 2789, 3086) – Aufbau wie alle Vorlagen-Seiten: Kopf mit „+ Neue Vorlage“, Umschalter
	 * nach Zweck, je Zweck eine Liste (Standard als Abzeichen, Betreff als Kennzahl-Zeile, „Als Standard“/„Kopieren“
	 * rechts). Bearbeiten mit Vorschau und Löschen auf der Detailseite. Firmensignatur unten.
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();

	const gruppen = $derived(
		MAIL_ZWECKE.filter((z) => !data.filter || data.filter === z).map((z) => ({
			zweck: z,
			eintraege: data.vorlagen
				.filter((v) => v.zweck === z)
				.map((v) => ({ id: v.id, name: v.name, href: `/einstellungen/mail-vorlagen/${v.id}`, meta: v.betreff, abzeichen: v.istStandard ? 'Standard' : null, istStandard: v.istStandard }))
		}))
	);
	let signatur = $state('');
	$effect.pre(() => {
		signatur = data.signatur ?? '';
	});
	const signaturMail = $derived(data.vorlagen.find((v) => v.zweck === 'allgemein' && v.istStandard) ?? data.vorlagen[0]);
	const signaturFehler = $derived(form && 'bereich' in form && form.bereich === 'signatur' && 'fehler' in form ? (form.fehler as string) : null);
	const signaturOk = $derived(!!(form && 'bereich' in form && form.bereich === 'signatur' && 'gespeichert' in form));
</script>

<svelte:head>
	<title>E-Mail-Vorlagen – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<VorlagenKopf
		titel="E-Mail-Vorlagen"
		meta="Alle Texte für Mails an Kunden an einem Ort. Je Zweck ist eine Vorlage der Standard – sie ist überall vorausgewählt, wo eine Mail vorbereitet wird, und lässt sich dort tauschen."
		neu={{ href: data.filter ? `/einstellungen/mail-vorlagen/neu?zweck=${data.filter}` : '/einstellungen/mail-vorlagen/neu' }}
	/>

	<div class="filter-leiste mv-filter">
		<Umschalter
			label="Zweck"
			aktiv={data.filter ?? 'alle'}
			eintraege={[{ wert: 'alle', text: 'Alle', href: '/einstellungen/mail-vorlagen' }, ...MAIL_ZWECKE.map((z) => ({ wert: z, text: ZWECK_NAMEN[z], href: `?zweck=${z}` }))]}
		/>
	</div>

	{#if form && 'fehler' in form && !('bereich' in form)}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	<div class="mv-bloecke">
		{#each gruppen as g (g.zweck)}
			<VorlagenListe titel={ZWECK_NAMEN[g.zweck]} label={`Vorlagen ${ZWECK_NAMEN[g.zweck]}`} hinweis={ZWECK_HINWEIS[g.zweck]} eintraege={g.eintraege} leer="Noch keine Vorlage für diesen Zweck.">
				{#snippet aktionen(v)}
					{#if !v.istStandard}<ZeilenAktion aktion="?/standard" id={v.id} symbol="stern">Als Standard</ZeilenAktion>{/if}
					<ZeilenAktion aktion="?/kopieren" id={v.id} symbol="kopieren">Kopieren</ZeilenAktion>
				{/snippet}
			</VorlagenListe>
		{/each}

		<Abschnitt titel="Firmensignatur">
			<form method="POST" action="?/signatur" use:enhance={() => async ({ update }) => update({ reset: false })} class="mv-signatur">
				<div class="mv-eingabe">
					{#if signaturFehler}<p role="alert" class="kd-fehler">{signaturFehler}</p>{/if}
					{#if signaturOk}<p role="status" class="mv-ok">Signatur gespeichert.</p>{/if}
					<label>
						Signatur (HTML) – in jede Vorlage mit „Signatur anhängen“
						<textarea name="signatur" rows="10" maxlength="20000" bind:value={signatur} placeholder="<p>Viele Grüße<br>Ihr Team von …</p>"></textarea>
					</label>
					<div class="form-fuss"><div class="form-fuss-rechts"><button type="submit" class="kd-knopf">Signatur speichern</button></div></div>
				</div>
				{#if signaturMail}
					<MailVorschau titel="Vorschau Signatur" html={signaturMail.html} betreff={signaturMail.betreff} text={signaturMail.text} {signatur} beispiele={data.beispiele} />
				{/if}
			</form>
		</Abschnitt>
	</div>
</main>

<style>
	.mv-filter {
		margin-bottom: var(--ui-a3);
		overflow-x: auto;
	}
	.mv-bloecke {
		display: grid;
		gap: var(--ui-abstand-block, var(--ui-a4));
	}
	.mv-signatur {
		display: grid;
		gap: 1rem;
		align-items: start;
	}
	@media (min-width: 64rem) {
		.mv-signatur {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
		}
	}
	.mv-eingabe {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.mv-eingabe label {
		display: grid;
		gap: 0.25rem;
	}
	.mv-eingabe textarea {
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 0.8125rem;
	}
	.mv-ok {
		margin: 0;
		color: var(--ui-gruen);
		font-weight: 600;
	}
</style>
