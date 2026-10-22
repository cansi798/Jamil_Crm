<script lang="ts">
	import { enhance } from '$app/forms';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import PortalSchalter from '$lib/components/ui/PortalSchalter.svelte';
	import { tagDeutsch, berlinTag } from '$lib/zeit';

	type Dokument = { id: string; name: string; typ: string; groesse: number; angelegt: string; vonId: string | null; vonName: string | null; imPortal: boolean };
	type Notiz = { id: string; text: string; angelegt: string; vonId: string | null; vonName: string | null; imPortal: boolean };

	/**
	 * Dokumente und Notizen direkt im Auftrag (Jamil msg 3070) – gleiche Bausteine wie die Links: „+ Dokument hochladen“
	 * und „+ Notiz hinzufügen“ als AddPanel, Liste mit Name/Text, Datum, Wer; je Eintrag „Im Kundenportal“ (nur wer das
	 * Portal verwaltet; Standard aus); Löschen der eigenen Einträge (Chef: aller) in der Zeile.
	 */
	let {
		dokumente,
		notizen,
		auftragId,
		benutzerId,
		darfBearbeiten,
		darfPortal,
		darfAlleLoeschen,
		form
	}: {
		dokumente: Dokument[];
		notizen: Notiz[];
		auftragId: string;
		benutzerId: string;
		darfBearbeiten: boolean;
		darfPortal: boolean;
		darfAlleLoeschen: boolean;
		form: { unterlageFehler?: string; unterlageArt?: string; notizText?: string } | null | undefined;
	} = $props();

	const wann = (iso: string) => tagDeutsch(berlinTag(new Date(iso)));
	const groesse = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
	const darfLoeschen = (vonId: string | null) => darfBearbeiten && (darfAlleLoeschen || vonId === benutzerId);
	const sofort = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

{#if dokumente.length === 0 && notizen.length === 0}
	<p class="kd-leer au-leer">Noch keine Dokumente oder Notizen – Fotos, PDFs und Notizen direkt hier hinzufügen.</p>
{:else}
	<ul class="au-liste" aria-label="Dokumente und Notizen">
		{#each dokumente as d (d.id)}
			<li class="au-eintrag">
				<a class="au-titel" href={`/api/dateien/${d.id}`} target="_blank" rel="noopener">{d.name}</a>
				<p class="au-meta">Dokument · {wann(d.angelegt)} · {groesse(d.groesse)}{d.vonName ? ` · ${d.vonName}` : ''}</p>
				{#if darfPortal || darfLoeschen(d.vonId) || d.imPortal}
					<div class="au-werkzeuge">
						{#if darfPortal}
							<PortalSchalter aktion="?/unterlagePortal" felder={{ art: 'datei', id: d.id }} an={d.imPortal} label={`„${d.name}“ im Kundenportal anzeigen`} />
						{:else if d.imPortal}
							<span class="kd-info">im Kundenportal sichtbar</span>
						{/if}
						{#if darfLoeschen(d.vonId)}
							<form method="POST" action="?/unterlageLoeschen" use:enhance={sofort}>
								<input type="hidden" name="art" value="datei" /><input type="hidden" name="id" value={d.id} />
								<button type="submit" class="kd-knopf hell klein" aria-label={`Dokument „${d.name}“ löschen`} onclick={(e) => { if (!confirm(`Dokument „${d.name}“ löschen?`)) e.preventDefault(); }}>Löschen</button>
							</form>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
		{#each notizen as n (n.id)}
			<li class="au-eintrag">
				<p class="au-notiz">{n.text}</p>
				<p class="au-meta">Notiz · {wann(n.angelegt)}{n.vonName ? ` · ${n.vonName}` : ''}</p>
				{#if darfPortal || darfLoeschen(n.vonId) || n.imPortal}
					<div class="au-werkzeuge">
						{#if darfPortal}
							<PortalSchalter aktion="?/unterlagePortal" felder={{ art: 'notiz', id: n.id }} an={n.imPortal} label={`Notiz vom ${wann(n.angelegt)} im Kundenportal anzeigen`} />
						{:else if n.imPortal}
							<span class="kd-info">im Kundenportal sichtbar</span>
						{/if}
						{#if darfLoeschen(n.vonId)}
							<form method="POST" action="?/unterlageLoeschen" use:enhance={sofort}>
								<input type="hidden" name="art" value="notiz" /><input type="hidden" name="id" value={n.id} />
								<button type="submit" class="kd-knopf hell klein" aria-label={`Notiz vom ${wann(n.angelegt)} löschen`} onclick={(e) => { if (!confirm('Notiz löschen?')) e.preventDefault(); }}>Löschen</button>
							</form>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
{#if form?.unterlageFehler && !form.unterlageArt}<p class="kd-fehler" role="alert">{form.unterlageFehler}</p>{/if}

{#if darfBearbeiten}
	<div class="au-hinzu">
		<AddPanel label="Dokument hochladen" offen={form?.unterlageArt === 'datei'}>
			{#snippet children(schliessen)}
				<form method="POST" action="?/dokumentNeu" enctype="multipart/form-data" class="kd-formular" use:enhance>
					<label>Datei (PDF, Foto, Word, Excel – höchstens 10 MB) <input type="file" name="datei" required accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,image/*,application/pdf" /></label>
					{#if darfPortal}<Schalter name="imPortal" label="Im Kundenportal sichtbar" hinweis="Standard: aus" />{/if}
					{#if form?.unterlageFehler && form.unterlageArt === 'datei'}<p class="kd-fehler" role="alert">{form.unterlageFehler}</p>{/if}
					<div class="af-fuss">
						<button type="submit" class="kd-knopf">Hochladen</button>
						<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					</div>
				</form>
			{/snippet}
		</AddPanel>
		<AddPanel label="Notiz hinzufügen" offen={form?.unterlageArt === 'notiz'}>
			{#snippet children(schliessen)}
				<form method="POST" action="?/notizNeu" class="kd-formular" use:enhance>
					<label>Notiz <textarea name="text" rows="3" maxlength="10000" required>{form?.notizText ?? ''}</textarea></label>
					{#if darfPortal}<Schalter name="imPortal" label="Im Kundenportal sichtbar" hinweis="Standard: aus – Notizen sind meist intern" />{/if}
					{#if form?.unterlageFehler && form.unterlageArt === 'notiz'}<p class="kd-fehler" role="alert">{form.unterlageFehler}</p>{/if}
					<div class="af-fuss">
						<button type="submit" class="kd-knopf">Notiz speichern</button>
						<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					</div>
				</form>
			{/snippet}
		</AddPanel>
	</div>
{/if}
<p class="au-mehr"><a href={`/auftraege/${auftragId}/dokumentation`}>Dokumentation öffnen</a> <span class="kd-info">(Protokolle, Unterschriften, alle Fotos)</span></p>

<style>
	.au-liste {
		list-style: none;
		margin: 0 0 var(--ui-a3);
		padding: 0;
		display: grid;
		gap: var(--ui-a2);
	}
	.au-eintrag {
		padding: var(--ui-a2) 0;
		border-bottom: 1px solid var(--ui-rand);
		min-width: 0;
	}
	.au-eintrag:last-child {
		border-bottom: none;
	}
	.au-titel {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.au-notiz {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.au-meta {
		margin: 0.15rem 0 0;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
	}
	.au-werkzeuge {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--ui-a2);
		margin-top: var(--ui-a2);
	}
	.au-werkzeuge form {
		margin: 0;
	}
	.au-leer {
		margin: 0 0 var(--ui-a3);
	}
	.au-hinzu {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--ui-a2);
	}
	.au-hinzu :global(.add-panel.offen) {
		flex: 1 1 100%;
	}
	.au-mehr {
		margin: var(--ui-a2) 0 0;
	}
</style>
