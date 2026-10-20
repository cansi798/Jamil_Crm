<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const p = $derived(data.profil);
	const werte = $derived(
		(form && 'werte' in form && form.werte) ||
			(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? v : ''])) as Record<string, string>)
	) as Record<string, string>;
	const logoUrl = $derived(`/api/einstellungen/briefkopf/logo?v=${encodeURIComponent(p.logoGeaendert ?? '')}`);
	const profilFehler = $derived(form && !('logoFehler' in form) && 'fehler' in form ? (form.fehler as string) : null);
	const logoFehler = $derived(form && 'logoFehler' in form && 'fehler' in form ? (form.fehler as string) : null);
</script>

<svelte:head>
	<title>Briefkopf</title>
</svelte:head>

<main class="kd-seite">
	<h1>Briefkopf</h1>
	<p class="kd-info">Diese Angaben und das Logo stehen auf jedem Angebot (PDF).</p>

	<h2>Logo</h2>
	<div class="bk-logo">
		{#if p.hatLogo}
			<img src={logoUrl} alt="Logo des Betriebs" />
		{:else}
			<p class="kd-leer">Noch kein Logo hinterlegt.</p>
		{/if}
	</div>
	{#if logoFehler}
		<p role="alert" class="kd-fehler">{logoFehler}</p>
	{:else if form && 'logoGespeichert' in form}
		<p role="status" class="bk-ok">Logo gespeichert.</p>
	{/if}
	<form method="POST" action="?/logo" enctype="multipart/form-data" use:enhance class="kd-formular">
		<label>
			PNG oder JPEG, höchstens 1 MB und 1500 × 1500 Pixel
			<input type="file" name="logo" accept="image/png,image/jpeg" required />
		</label>
		<div class="kd-aktionen">
			<button type="submit" class="kd-knopf">Logo hochladen</button>
		</div>
	</form>
	{#if p.hatLogo}
		<form method="POST" action="?/logoLoeschen" use:enhance class="bk-loeschen">
			<button type="submit" class="kd-knopf hell">Logo entfernen</button>
		</form>
	{/if}

	<h2>Angaben</h2>
	<form method="POST" action="?/speichern" use:enhance={() => async ({ update }) => update({ reset: false })} class="kd-formular">
		{#if profilFehler}
			<p role="alert" class="kd-fehler">{profilFehler}</p>
		{:else if form && 'gespeichert' in form}
			<p role="status" class="bk-ok">Gespeichert.</p>
		{/if}
		<label>Firmenname <input type="text" name="firmenname" maxlength="200" value={werte.firmenname ?? ''} autocomplete="organization" /></label>
		<label>Straße und Hausnummer <input type="text" name="strasse" maxlength="200" value={werte.strasse ?? ''} /></label>
		<div class="kd-zwei">
			<label>PLZ <input type="text" name="plz" maxlength="20" value={werte.plz ?? ''} /></label>
			<label>Ort <input type="text" name="ort" maxlength="200" value={werte.ort ?? ''} /></label>
		</div>
		<div class="kd-zwei">
			<label>Telefon <input type="tel" name="telefon" maxlength="50" value={werte.telefon ?? ''} /></label>
			<label>E-Mail <input type="email" name="email" maxlength="200" value={werte.email ?? ''} /></label>
		</div>
		<label>Internetseite <input type="text" name="web" maxlength="200" value={werte.web ?? ''} /></label>
		<label class="bk-farbe">
			Hausfarbe (Online-Buchungsseite)
			<input type="color" name="farbe" value={werte.farbe || '#0f6cbd'} />
		</label>
		<div class="kd-zwei">
			<label>Steuernummer <input type="text" name="steuernummer" maxlength="50" value={werte.steuernummer ?? ''} /></label>
			<label>USt-IdNr. <input type="text" name="ustId" maxlength="20" value={werte.ustId ?? ''} /></label>
		</div>
		<label>Bank <input type="text" name="bank" maxlength="200" value={werte.bank ?? ''} /></label>
		<div class="kd-zwei">
			<label>IBAN <input type="text" name="iban" maxlength="42" value={werte.iban ?? ''} autocomplete="off" /></label>
			<label>BIC <input type="text" name="bic" maxlength="11" value={werte.bic ?? ''} autocomplete="off" /></label>
		</div>
		<label>Fußzeile (z. B. Geschäftsführer, Handelsregister) <textarea name="fusszeile" maxlength="500" rows="3">{werte.fusszeile ?? ''}</textarea></label>
		<div class="kd-aktionen">
			<button type="submit" class="kd-knopf">Speichern</button>
		</div>
	</form>
</main>

<style>
	.bk-farbe input {
		width: 4rem !important;
		height: 2.5rem;
		padding: 0.15rem !important;
		cursor: pointer;
	}
	.bk-logo {
		display: flex;
		align-items: center;
		min-height: 5rem;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		border: 1px dashed var(--rand);
		border-radius: 0.5rem;
		background: #fff;
	}
	.bk-logo img {
		max-height: 6rem;
		max-width: 100%;
		object-fit: contain;
	}
	.bk-ok {
		color: #1b6b2a;
		margin: 0 0 0.5rem;
	}
	.bk-loeschen {
		margin-top: 0.5rem;
	}
</style>
