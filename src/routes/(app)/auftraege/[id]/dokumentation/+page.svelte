<script lang="ts">
	import DateiUpload from '$lib/components/DateiUpload.svelte';
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

<h1>Dokumentation – {data.auftrag.titel}</h1>

<nav class="tabs">
	<button class:aktiv={tab === 'fotos'} onclick={() => (tab = 'fotos')}>Fotos</button>
	<button class:aktiv={tab === 'notizen'} onclick={() => (tab = 'notizen')}>Notizen</button>
	<button class:aktiv={tab === 'protokolle'} onclick={() => (tab = 'protokolle')}>Protokolle</button>
</nav>

{#if tab === 'fotos'}
	<section>
		<h2>Fotos und Dateien</h2>
		<DateiUpload auftragId={data.auftrag.id} bind:dateien />
	</section>
{:else if tab === 'notizen'}
	<section>
		<h2>Notizen</h2>

		<form onsubmit={(e) => { e.preventDefault(); notizAnlegen(); }} class="notiz-form">
			<textarea bind:value={neueNotiz} placeholder="Neue Notiz eingeben…" rows="3" maxlength="10000"></textarea>
			{#if notizFehler}<p class="fehler">{notizFehler}</p>{/if}
			<button type="submit" disabled={notizLaedt || !neueNotiz.trim()}>
				{notizLaedt ? 'Wird gespeichert…' : 'Notiz speichern'}
			</button>
		</form>

		{#if notizen.length === 0}
			<p>Keine Notizen vorhanden.</p>
		{:else}
			<ul class="notiz-liste">
				{#each notizen as n (n.id)}
					<li>
						{#if editiertNotizId === n.id}
							<form onsubmit={(e) => { e.preventDefault(); notizSpeichern(n.id); }} class="notiz-edit">
								<textarea bind:value={editierterText} rows="3"></textarea>
								<div class="notiz-aktionen">
									<button type="submit">Speichern</button>
									<button type="button" onclick={() => { editiertNotizId = null; editierterText = ''; }}>Abbrechen</button>
								</div>
							</form>
						{:else}
							<div class="notiz-inhalt">
								<p>{n.text}</p>
								<span class="notiz-meta">{new Date(n.angelegt).toLocaleString('de-DE')}</span>
							</div>
							<div class="notiz-aktionen">
								<button type="button" onclick={() => { editiertNotizId = n.id; editierterText = n.text; }}>Bearbeiten</button>
								<button type="button" onclick={() => notizLoeschen(n.id)}>Löschen</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{:else if tab === 'protokolle'}
	<section>
		<h2>Baustellen-Protokolle</h2>
		<button type="button" onclick={() => (neuesProtokoll = true)} data-testid="protokoll-neu">
			Neues Protokoll
		</button>

		{#if neuesProtokoll}
			<form onsubmit={(e) => { e.preventDefault(); protokollAnlegen(); }}>
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
				<button type="submit" disabled={protokollLaedt} data-testid="protokoll-speichern">
					{protokollLaedt ? 'Wird gespeichert…' : 'Speichern'}
				</button>
			</form>
		{/if}

		{#if protokolle.length === 0}
			<p>Keine Protokolle vorhanden.</p>
		{:else}
			<ul class="protokoll-liste">
				{#each protokolle as prot (prot.id)}
					<li>
						<strong>{prot.typ}</strong>
						<span>{new Date(prot.angelegt).toLocaleDateString('de-DE')}</span>
						{#if prot.unterschriftVorhanden}
							<span data-testid="unterschrift-vorhanden">✓ Unterschrift</span>
						{:else}
							<button type="button" onclick={() => { unterschriftProtokollId = prot.id; unterschriftOffen = true; }}>
								Unterschrift
							</button>
						{/if}
						<button type="button" onclick={() => pdfErzeugen(prot.id)}>PDF</button>
						<button type="button" onclick={() => emailSenden(prot.id)}>E-Mail</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if unterschriftOffen}
			<div class="unterschrift-dialog">
				<h3>Unterschrift</h3>
				<Unterschrift onunterschrift={unterschriftSpeichern} />
				<button type="button" onclick={() => { unterschriftOffen = false; unterschriftProtokollId = null; }}>
					Abbrechen
				</button>
			</div>
		{/if}
	</section>
{/if}

<style>
	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.tabs button {
		padding: 0.5rem 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
	.tabs button.aktiv {
		background: var(--farbe-primaer, #05346b);
		color: #fff;
		border-color: var(--farbe-primaer, #05346b);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 400px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	textarea {
		min-height: 80px;
	}
	.fehler {
		color: #c00;
	}
	.protokoll-liste {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid #eee;
		border-radius: 4px;
	}
	li button {
		padding: 0.25rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
	.unterschrift-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: #fff;
		padding: 1rem;
		box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
		z-index: 100;
	}
	.notiz-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 500px;
	}
	.notiz-liste {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.notiz-liste li {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid #eee;
		border-radius: 4px;
	}
	.notiz-inhalt p {
		margin: 0;
		white-space: pre-wrap;
	}
	.notiz-meta {
		font-size: 0.85rem;
		color: #666;
	}
	.notiz-aktionen {
		display: flex;
		gap: 0.5rem;
	}
	.notiz-aktionen button {
		padding: 0.25rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.notiz-edit {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>