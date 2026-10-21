<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import { enhance } from '$app/forms';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import type { PartnerArt } from '$lib/partner';

	/**
	 * Partner am Auftrag (Jamil msg 2856): Auftraggeber (vorbelegt über die Auftragsquelle), Subunternehmer mit Warnung bei
	 * abgelaufenen Nachweisen, Fremdleistungen (Rechnungen von Partnern) – fließen in die Nachkalkulation.
	 */
	let {
		partner,
		auswahl,
		darfBearbeiten,
		form
	}: {
		partner: {
			auftraggeber: { id: string; name: string } | null;
			subunternehmer: { id: string; name: string; leistung: string | null; warnung: string | null }[];
			fremdleistungen?: { id: string; bezeichnung: string; betragCent: number; partnerName: string | null; rechnungsnummer: string | null; datum: string | null }[];
			summeFremdCent?: number;
		};
		auswahl: { id: string; name: string; art: PartnerArt; warnung: string | null }[];
		darfBearbeiten: boolean;
		form: { partnerFehler?: string; partnerWarnung?: string | null } | null | undefined;
	} = $props();
	const sofort = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const auftraggeber = $derived(auswahl.filter((p) => p.art === 'auftraggeber'));
	const subs = $derived(auswahl.filter((p) => p.art === 'subunternehmer' && !partner.subunternehmer.some((s) => s.id === p.id)));
</script>

{#if form?.partnerFehler}<p class="kd-fehler" role="alert">{form.partnerFehler}</p>{/if}
{#if form?.partnerWarnung}<p class="ap-warnung" role="alert">⚠ {form.partnerWarnung}</p>{/if}

<div class="ap-zeile">
	<span class="kd-info">Auftraggeber</span>
	{#if darfBearbeiten && auftraggeber.length}
		<form method="POST" action="?/auftraggeber" use:enhance={sofort}>
			<Auswahl name="partnerId" aria-label="Auftraggeber" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				<option value="" selected={!partner.auftraggeber}>– keiner –</option>
				{#each auftraggeber as p (p.id)}<option value={p.id} selected={partner.auftraggeber?.id === p.id}>{p.name}</option>{/each}
			</Auswahl>
		</form>
	{:else}
		<strong>{partner.auftraggeber?.name ?? '–'}</strong>
	{/if}
</div>

<div class="ap-block">
	<span class="kd-info">Subunternehmer</span>
	<ul class="ap-liste">
		{#each partner.subunternehmer as s (s.id)}
			<li>
				<span><strong>{s.name}</strong>{s.leistung ? ` · ${s.leistung}` : ''}{#if s.warnung}<span class="ap-warnung">⚠ Nachweis {s.warnung}</span>{/if}</span>
				{#if darfBearbeiten}
					<form method="POST" action="?/subunternehmerWeg" use:enhance={sofort}>
						<input type="hidden" name="partnerId" value={s.id} />
						<button type="submit" class="knopf-subtil klein" aria-label={`${s.name} entfernen`} use:rueckfrage={{ frage: `${s.name} wirklich vom Auftrag entfernen?`, ja: 'Entfernen' }}>Entfernen</button>
					</form>
				{/if}
			</li>
		{:else}
			<li class="kd-info">keine</li>
		{/each}
	</ul>
	{#if darfBearbeiten && subs.length}
		<AddPanel label="Subunternehmer zuordnen">
			{#snippet children(schliessen)}
				<form method="POST" action="?/subunternehmer" use:enhance class="kd-formular">
					<label>Subunternehmer
						<Auswahl name="partnerId" required>
							<option value="">– bitte wählen –</option>
							{#each subs as p (p.id)}<option value={p.id}>{p.name}{p.warnung ? ` (⚠ ${p.warnung})` : ''}</option>{/each}
						</Auswahl>
					</label>
					<label>Leistung (optional) <input name="leistung" maxlength="300" placeholder="z. B. Elektro, Estrich" /></label>
					<div class="af-fuss">
						<button type="submit" class="kd-knopf">Zuordnen</button>
						<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					</div>
				</form>
			{/snippet}
		</AddPanel>
	{/if}
</div>

{#if partner.fremdleistungen}
	<div class="ap-block">
		<span class="kd-info">Fremdleistungen (netto, in der Nachkalkulation){partner.summeFremdCent ? ` · gesamt ${euro(partner.summeFremdCent)}` : ''}</span>
		<ul class="ap-liste">
			{#each partner.fremdleistungen as f (f.id)}
				<li>
					<span>
						<strong>{euro(f.betragCent)}</strong> {f.bezeichnung}
						<span class="kd-info">{[f.partnerName, f.rechnungsnummer ? `Rechnung ${f.rechnungsnummer}` : null, f.datum ? tagDeutsch(f.datum) : null].filter(Boolean).join(' · ')}</span>
					</span>
					{#if darfBearbeiten}
						<form method="POST" action="?/fremdleistungWeg" use:enhance={sofort}>
							<input type="hidden" name="id" value={f.id} />
							<button type="submit" class="knopf-subtil klein" use:rueckfrage={'Fremdleistung wirklich löschen?'}>Löschen</button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="kd-info">keine</li>
			{/each}
		</ul>
		{#if darfBearbeiten}
			<AddPanel label="Fremdleistung erfassen">
				{#snippet children(schliessen)}
					<form method="POST" action="?/fremdleistung" use:enhance class="kd-formular">
						<label>Bezeichnung <input name="bezeichnung" required maxlength="200" placeholder="z. B. Elektroinstallation" /></label>
						<label>Betrag netto (€) <input name="betrag" required inputmode="decimal" placeholder="1.250,00" /></label>
						<label>Partner (optional)
							<Auswahl name="partnerId">
								<option value="">–</option>
								{#each auswahl as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
							</Auswahl>
						</label>
						<label>Rechnungsnummer (optional) <input name="rechnungsnummer" maxlength="60" /></label>
						<label>Datum (optional) <input name="datum" type="date" /></label>
						<div class="af-fuss">
							<button type="submit" class="kd-knopf">Speichern</button>
							<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
						</div>
					</form>
				{/snippet}
			</AddPanel>
		{/if}
	</div>
{/if}

<style>
	.ap-zeile,
	.ap-block {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	.ap-zeile form {
		margin: 0;
	}
	.ap-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.ap-liste li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ap-liste form {
		margin: 0;
	}
	.ap-warnung {
		display: block;
		color: var(--ui-gefahr);
		font-weight: 600;
		font-size: var(--ui-schrift-s);
	}
</style>
