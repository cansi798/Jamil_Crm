<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import { enhance } from '$app/forms';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import PortalSchalter from '$lib/components/ui/PortalSchalter.svelte';
	import type { AuftragLink } from '$lib/server/auftrag-links';

	/**
	 * Links am Auftrag (Jamil msg 2850): Titel, Domain, Notiz; öffnet in neuem Tab ohne Referrer. Bearbeiten nur mit
	 * „Aufträge bearbeiten“; „Im Kundenportal“ nur, wer das Portal verwaltet (wie bei den Dokumenten).
	 */
	let {
		links,
		darfBearbeiten,
		darfPortal,
		form
	}: {
		links: AuftragLink[];
		darfBearbeiten: boolean;
		darfPortal: boolean;
		form: { linkFehler?: string; linkFehlerId?: string; linkWerte?: { titel: string; url: string; notiz: string } } | null | undefined;
	} = $props();

	let bearbeiteId = $state<string | null>(null);
	const sofort = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

{#if links.length === 0}
	<p class="kd-leer al-leer">Noch keine Links – z. B. das Partner-Portal mit dem Abnahmeprotokoll.</p>
{:else}
	<ul class="al-liste">
		{#each links as l (l.id)}
			<li class="al-eintrag">
				{#if bearbeiteId === l.id}
					<form method="POST" action="?/linkAendern" class="kd-formular" use:enhance={() => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') bearbeiteId = null; }}>
						<input type="hidden" name="linkId" value={l.id} />
						<label>Titel <input name="titel" value={l.titel} maxlength="200" /></label>
						<label>Webadresse <input name="url" value={l.url} required maxlength="2000" inputmode="url" /></label>
						<label>Notiz (optional) <input name="notiz" value={l.notiz ?? ''} maxlength="500" /></label>
						{#if form?.linkFehler && form.linkFehlerId === l.id}<p class="kd-fehler" role="alert">{form.linkFehler}</p>{/if}
						<div class="af-fuss">
							<button type="submit" class="kd-knopf">Speichern</button>
							<button type="button" class="kd-knopf hell" onclick={() => (bearbeiteId = null)}>Abbrechen</button>
						</div>
					</form>
				{:else}
					<a class="al-link" href={l.url} target="_blank" rel="noopener noreferrer external">
						<span class="al-titel">{l.titel}</span>
						<span class="al-domain">{l.domain} ↗</span>
					</a>
					{#if l.notiz}<p class="al-notiz">{l.notiz}</p>{/if}
					{#if darfPortal || darfBearbeiten || l.imPortal}
						<div class="al-werkzeuge">
							{#if darfPortal}
								<PortalSchalter aktion="?/linkPortal" felder={{ linkId: l.id }} an={l.imPortal} label={`„${l.titel}“ im Kundenportal anzeigen`} />
							{:else if l.imPortal}
								<span class="kd-info">im Kundenportal sichtbar</span>
							{/if}
							{#if darfBearbeiten}
								<button type="button" class="kd-knopf hell klein" onclick={() => (bearbeiteId = l.id)} aria-label={`Link „${l.titel}“ bearbeiten`}>Bearbeiten</button>
								<form method="POST" action="?/linkLoeschen" use:enhance={sofort}>
									<input type="hidden" name="linkId" value={l.id} />
									<button type="submit" class="kd-knopf hell klein" aria-label={`Link „${l.titel}“ entfernen`} use:rueckfrage={{ frage: `Link „${l.titel}“ wirklich entfernen?`, ja: 'Entfernen' }}>Entfernen</button>
								</form>
							{/if}
						</div>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}
{#if form?.linkFehler && !form.linkFehlerId && !form.linkWerte}<p class="kd-fehler" role="alert">{form.linkFehler}</p>{/if}

{#if darfBearbeiten}
	<AddPanel label="Link hinzufügen" offen={!!form?.linkWerte}>
		{#snippet children(schliessen)}
			<form method="POST" action="?/linkNeu" class="kd-formular" use:enhance>
				<label>Webadresse <input name="url" required maxlength="2000" inputmode="url" placeholder="https://portal.partner.de/auftrag/123" value={form?.linkWerte?.url ?? ''} /></label>
				<label>Titel (optional) <input name="titel" maxlength="200" placeholder="z. B. Abnahmeprotokoll beim Partner" value={form?.linkWerte?.titel ?? ''} /></label>
				<label>Notiz (optional) <input name="notiz" maxlength="500" placeholder="z. B. Zugang beim Bauleiter erfragen" value={form?.linkWerte?.notiz ?? ''} /></label>
				{#if darfPortal}<Schalter name="imPortal" label="Im Kundenportal anzeigen" hinweis="Standard: aus" />{/if}
				<p class="kd-info">Bitte keine Passwörter in Adresse oder Notiz speichern.</p>
				{#if form?.linkFehler && form.linkWerte}<p class="kd-fehler" role="alert">{form.linkFehler}</p>{/if}
				<div class="af-fuss">
					<button type="submit" class="kd-knopf">Link speichern</button>
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
				</div>
			</form>
		{/snippet}
	</AddPanel>
{/if}

<style>
	.al-liste {
		list-style: none;
		margin: 0 0 var(--ui-a3);
		padding: 0;
		display: grid;
		gap: var(--ui-a2);
	}
	.al-eintrag {
		padding: var(--ui-a2) 0;
		border-bottom: 1px solid var(--ui-rand);
		min-width: 0;
	}
	.al-eintrag:last-child {
		border-bottom: none;
	}
	.al-link {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem 0.6rem;
		min-height: 44px;
		align-content: center;
		text-decoration: none;
		min-width: 0;
	}
	.al-titel {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.al-domain {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		overflow-wrap: anywhere;
	}
	.al-notiz {
		margin: 0.15rem 0 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		overflow-wrap: anywhere;
	}
	.al-werkzeuge {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--ui-a2);
		margin-top: var(--ui-a2);
	}
	.al-werkzeuge form {
		margin: 0;
	}
	.al-leer {
		margin: 0 0 var(--ui-a3);
	}
</style>
