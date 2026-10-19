<script lang="ts">
	import DateiUpload from '$lib/components/DateiUpload.svelte';
	import Karte from '$lib/components/Karte.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Unterschrift from '$lib/components/Unterschrift.svelte';

	let { data } = $props();

	let tab = $state<'fotos' | 'notizen' | 'protokolle'>('fotos');
	let dateien = $state.raw(data.dateien);
	let protokolle = $state.raw(data.protokolle);

	// Notizen
	let notizen = $state.raw<any[]>([]);
	let neueNotiz = $state('');
	let notizFehler = $state<string | null>(null);
	let notizLaedt = $state(false);
	let editiertNotizId = $state<string | null>(null);
	let editierterText = $state('');

	// Neues Protokoll
	let neuesProtokoll = $state(false);
	let protokollTyp = $state<string>('abnahme');
	let protokollBemerkung = $state('');
	let protokollFehler = $state<string | null>(null);
	let protokollLaedt = $state(false);

	// Unterschrift
	let unterschriftProtokollId = $state<string | null>(null);
	let unterschriftOffen = $state(false);

	// Notizen laden
	async function notizenLaden() {
		try {
			const res = await fetch(`/api/notizen?auftragId=${data.auftrag.id}`);
			if (res.ok) notizen = await res.json();
		} catch (e) { /* ignore */ }
	}

	// Notiz anlegen
	async function notizAnlegen() {
		if (!neueNotiz.trim()) return;
		notizLaedt = true;
		notizFehler = null;
		try {
			const res = await fetch('/api/notizen', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ auftragId: data.auftrag.id, text: neueNotiz })
			});
			if (!res.ok) throw new Error((await res.json()).fehler || 'Fehler');
			const erg = await res.json();
			notizen = [erg, ...notizen];
			neueNotiz = '';
		} catch (e) {
			notizFehler = e instanceof Error ? e.message : 'Fehler';
		} finally {
			notizLaedt = false;
		}
	}

	// Notiz bearbeiten
	async function notizSpeichern(id: string) {
		try {
			const res = await fetch(`/api/notizen/${id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: editierterText })
			});
			if (!res.ok) throw new Error((await res.json()).fehler || 'Fehler');
			const erg = await res.json();
			notizen = notizen.map((n) => (n.id === id ? erg : n));
			editiertNotizId = null;
			editierterText = '';
		} catch (e) { /* ignore */ }
	}

	// Notiz löschen
	async function notizLoeschen(id: string) {
		if (!confirm('Notiz löschen?')) return;
		try {
			const res = await fetch(`/api/notizen/${id}`, { method: 'DELETE' });
			if (res.ok) notizen = notizen.filter((n) => n.id !== id);
		} catch (e) { /* ignore */ }
	}

	// Notizen beim Laden holen
	$effect(() => { notizenLaden(); });

	async function protokollAnlegen() {
		protokollLaedt = true;
		protokollFehler = null;
		try {
			const res = await fetch('/api/protokolle', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					auftragId: data.auftrag.id,
					typ: protokollTyp,
					inhalt: protokollBemerkung ? { bemerkung: protokollBemerkung } : {}
				})
			});
			if (!res.ok) {
				const body = await res.json();
				throw new Error(body.fehler || 'Protokoll konnte nicht angelegt werden');
			}
			const erg = await res.json();
			protokolle = [erg, ...protokolle];
			neuesProtokoll = false;
			protokollBemerkung = '';
		} catch (e) {
			protokollFehler = e instanceof Error ? e.message : 'Fehler';
		} finally {
			protokollLaedt = false;
		}
	}

	async function unterschriftSpeichern(png: Uint8Array) {
		if (!unterschriftProtokollId) return;
		const res = await fetch(`/api/protokolle/${unterschriftProtokollId}/unterschrift`, {
			method: 'POST',
			body: new Blob([new Uint8Array(png)])
		});
		if (res.ok) {
			unterschriftOffen = false;
			unterschriftProtokollId = null;
			// Protokoll-Liste aktualisieren
			const idx = protokolle.findIndex((p) => p.id === unterschriftProtokollId);
			if (idx >= 0) protokolle[idx] = { ...protokolle[idx], unterschriftVorhanden: true };
		}
	}

	async function pdfErzeugen(id: string) {
		const res = await fetch(`/api/protokolle/${id}/pdf`);
		if (res.ok) {
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		}
	}

	async function emailSenden(id: string) {
		const res = await fetch(`/api/protokolle/${id}/email`, { method: 'POST' });
		if (res.ok) {
			alert('E-Mail gesendet');
		} else {
			const body = await res.json();
			alert(body.fehler || 'E-Mail fehlgeschlagen');
		}
	}
</script>

<main class="kd-seite">
	<a href={`/auftraege/${data.auftrag.id}`} class="kd-zurueck">← Auftrag</a>
	<header class="seiten-kopf">
		<h1>Dokumentation – {data.auftrag.titel}</h1>
	</header>

	<nav class="pills" aria-label="Bereiche">
		<button class="pill" class:aktiv={tab === 'fotos'} onclick={() => (tab = 'fotos')}>Fotos</button>
		<button class="pill" class:aktiv={tab === 'notizen'} onclick={() => (tab = 'notizen')}>Notizen</button>
		{#if data.protokolleLesbar}
			<button class="pill" class:aktiv={tab === 'protokolle'} onclick={() => (tab = 'protokolle')}>Protokolle</button>
		{/if}
	</nav>

	{#if tab === 'fotos'}
		<Karte>
			{#snippet titel()}Fotos und Dateien{/snippet}
			{#if data.darfBearbeiten}
				<DateiUpload auftragId={data.auftrag.id} bind:dateien />
			{:else}
				<ul class="kd-liste">
					{#each dateien as d (d.id)}
						<li><a href={`/api/dateien/${d.id}`} target="_blank" rel="noopener">{d.name}</a></li>
					{:else}
						<li class="kd-leer">Keine Fotos oder Dateien vorhanden.</li>
					{/each}
				</ul>
			{/if}
		</Karte>
	{:else if tab === 'notizen'}
		<Karte>
			{#snippet titel()}Notizen{/snippet}
			{#if data.darfBearbeiten}
				<AddPanel label="Notiz hinzufügen" art="primaer">
					{#snippet children(schliessen)}
						<form
							onsubmit={async (e) => {
								e.preventDefault();
								await notizAnlegen();
								if (!notizFehler) schliessen();
							}}
							class="notiz-form"
						>
							<textarea bind:value={neueNotiz} placeholder="Neue Notiz eingeben…" rows="3" maxlength="10000" aria-label="Neue Notiz"></textarea>
							{#if notizFehler}<p class="fehler">{notizFehler}</p>{/if}
							<div class="knopf-reihe">
								<button type="submit" class="knopf-gefuellt" disabled={notizLaedt || !neueNotiz.trim()}>
									{notizLaedt ? 'Wird gespeichert…' : 'Notiz speichern'}
								</button>
								<button type="button" class="knopf-sekundaer" onclick={schliessen}>Abbrechen</button>
							</div>
						</form>
					{/snippet}
				</AddPanel>
			{/if}

			{#if notizen.length === 0}
				<p class="kd-leer">Keine Notizen vorhanden.</p>
			{:else}
				<ul class="notiz-liste">
					{#each notizen as n (n.id)}
						<li class="karte">
							{#if editiertNotizId === n.id}
								<form onsubmit={(e) => { e.preventDefault(); notizSpeichern(n.id); }} class="notiz-edit">
									<textarea bind:value={editierterText} rows="3"></textarea>
									<div class="notiz-aktionen">
										<button type="submit" class="knopf-gefuellt">Speichern</button>
										<button type="button" class="knopf-subtil" onclick={() => { editiertNotizId = null; editierterText = ''; }}>Abbrechen</button>
									</div>
								</form>
							{:else}
								<div class="notiz-inhalt">
									<p>{n.text}</p>
									<span class="notiz-meta">{new Date(n.angelegt).toLocaleString('de-DE')}</span>
								</div>
								{#if data.darfBearbeiten}
									<div class="notiz-aktionen">
										<button type="button" class="knopf-subtil" onclick={() => { editiertNotizId = n.id; editierterText = n.text; }}>Bearbeiten</button>
										<button type="button" class="knopf-gefahr" onclick={() => notizLoeschen(n.id)}>Löschen</button>
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Karte>
	{:else if tab === 'protokolle' && data.protokolleLesbar}
		<Karte>
			{#snippet titel()}Baustellen-Protokolle{/snippet}
			{#snippet aktionen()}
				{#if data.darfProtokolle}
					<button type="button" class="knopf-gefuellt" onclick={() => (neuesProtokoll = true)} data-testid="protokoll-neu">
						Neues Protokoll
					</button>
				{/if}
			{/snippet}

			{#if neuesProtokoll}
				<form onsubmit={(e) => { e.preventDefault(); protokollAnlegen(); }} class="protokoll-form">
					<label>
						Typ
						<select bind:value={protokollTyp} data-testid="protokoll-typ">
							<option value="abnahme">Abnahme</option>
							<option value="regiebericht">Regiebericht</option>
							<option value="aufmass">Aufmaß</option>
							<option value="maengelliste">Mängelliste</option>
						</select>
					</label>
					<label>
						Bemerkung
						<textarea bind:value={protokollBemerkung} data-testid="protokoll-bemerkung"></textarea>
					</label>
					{#if protokollFehler}
						<p class="fehler">{protokollFehler}</p>
					{/if}
					<button type="submit" class="knopf-gefuellt" disabled={protokollLaedt} data-testid="protokoll-speichern">
						{protokollLaedt ? 'Wird gespeichert…' : 'Speichern'}
					</button>
				</form>
			{/if}

			{#if protokolle.length === 0}
				<p class="kd-leer">Keine Protokolle vorhanden.</p>
			{:else}
				<ul class="protokoll-liste">
					{#each protokolle as prot (prot.id)}
						<li class="karte">
							<div class="protokoll-kopf">
								<strong>{prot.typ}</strong>
								<span class="kd-info">{new Date(prot.angelegt).toLocaleDateString('de-DE')}</span>
								{#if prot.unterschriftVorhanden}
									<span class="badge badge-gruen" data-testid="unterschrift-vorhanden">✓ Unterschrift</span>
								{/if}
							</div>
							<div class="protokoll-aktionen">
								{#if !prot.unterschriftVorhanden && data.darfProtokolle}
									<button type="button" class="knopf-subtil" onclick={() => { unterschriftProtokollId = prot.id; unterschriftOffen = true; }}>
										Unterschrift
									</button>
								{/if}
								<button type="button" class="knopf-subtil" onclick={() => pdfErzeugen(prot.id)}>PDF</button>
								{#if data.darfProtokolle}
									<button type="button" class="knopf-subtil" onclick={() => emailSenden(prot.id)}>E-Mail</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if unterschriftOffen}
				<div class="unterschrift-dialog">
					<h3>Unterschrift</h3>
					<Unterschrift onunterschrift={unterschriftSpeichern} />
					<button type="button" class="knopf-subtil" onclick={() => { unterschriftOffen = false; unterschriftProtokollId = null; }}>
						Abbrechen
					</button>
				</div>
			{/if}
		</Karte>
	{/if}
</main>

<style>
	.pills {
		margin-bottom: 1rem;
	}
	.notiz-form,
	.protokoll-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 500px;
		margin-bottom: 1rem;
	}
	.notiz-form textarea,
	.protokoll-form textarea {
		min-height: 80px;
	}
	.fehler {
		color: var(--m365-fehler);
	}
	.notiz-liste,
	.protokoll-liste {
		list-style: none;
		margin: 0.75rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.notiz-liste li,
	.protokoll-liste li {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.notiz-inhalt p {
		margin: 0;
		white-space: pre-wrap;
	}
	.notiz-meta {
		font-size: 0.85rem;
		color: var(--m365-text-leise);
	}
	.notiz-aktionen,
	.protokoll-aktionen {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.notiz-edit {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.protokoll-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}
	.unterschrift-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--m365-flaeche);
		padding: 1rem;
		box-shadow: var(--m365-schatten-hoch);
		z-index: 100;
	}
</style>