<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { rueckfrage } from '$lib/rueckfrage';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import DateiFeld from '$lib/components/ui/DateiFeld.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import { farbStil, STANDARD_FARBE } from '$lib/farbe';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const p = $derived(data.profil);
	const werte = $derived(
		(form && 'werte' in form && form.werte) ||
			(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? v : ''])) as Record<string, string>)
	) as Record<string, string>;
	const logoUrl = $derived(`/api/einstellungen/briefkopf/logo?v=${encodeURIComponent(p.logoGeaendert ?? '')}`);
	const profilFehler = $derived(form && !('logoFehler' in form) && 'fehler' in form ? (form.fehler as string) : null);
	const logoFehler = $derived(form && 'logoFehler' in form && form.logoFehler !== 'dunkel' && 'fehler' in form ? (form.fehler as string) : null);
	const logoDunkelFehler = $derived(form && 'logoFehler' in form && form.logoFehler === 'dunkel' && 'fehler' in form ? (form.fehler as string) : null);
	const logoDunkelUrl = $derived(`/api/marke/logo?variante=dunkel&v=${encodeURIComponent(p.logoDunkelGeaendert ?? '')}`);
</script>

<svelte:head>
	<title>Briefkopf</title>
</svelte:head>

<main class="kd-seite">
	<h1>Briefkopf</h1>
	<p class="kd-info">Diese Angaben und das Logo stehen auf jedem Angebot (PDF).<InfoFenster id="briefkopf.seite" /></p>

	<h2>Logo</h2>
	<DateiFeld
		id="logo"
		vorhanden={p.hatLogo}
		feldLabel="PNG oder JPEG, höchstens 1 MB und 1500 × 1500 Pixel"
		feldName="logo"
		accept="image/png,image/jpeg"
		hochladenAktion="?/logo"
		hochladenText="Logo hochladen"
		entfernenAktion="?/logoLoeschen"
		entfernenText="Logo entfernen"
		ding="Logo"
		warnung="Das Logo wird entfernt und steht nicht mehr auf Angeboten, Auftragsbestätigungen und in der App. Sie können es jederzeit wieder hochladen."
		fehler={logoFehler}
		meldung={form && 'logoGespeichert' in form && form.logoGespeichert !== 'dunkel' ? 'Logo gespeichert.' : null}
	>
		{#snippet vorschau()}
			<div class="bk-logo">
				{#if p.hatLogo}<img src={logoUrl} alt="Logo des Betriebs" />{:else}<p class="kd-leer">Noch kein Logo hinterlegt.</p>{/if}
			</div>
		{/snippet}
	</DateiFeld>

	<h2 id="logo-dunkel-titel">Helle Variante für dunklen Hintergrund (App)</h2>
	<p class="kd-info">
		Für die dunkle Seitenleiste der App am Computer (oben links): eine helle Variante (z. B. weiße Schrift, am besten PNG mit
		transparentem Hintergrund). Ohne helle Variante steht das normale Logo dort auf einem weißen Feld. Am Handy (heller
		Hintergrund) erscheint in der App das Logo von oben. Im Kundenportal wird das normale Logo verwendet – die helle Variante
		nur, wenn Sie unten eine dunkle Kopffarbe fürs Portal wählen.
	</p>
	<DateiFeld
		id="logo-dunkel"
		vorhanden={p.hatLogoDunkel}
		feldLabel="Helle Variante – PNG oder JPEG (am besten PNG mit transparentem Hintergrund)"
		feldName="logo"
		accept="image/png,image/jpeg"
		hochladenAktion="?/logoDunkel"
		hochladenText="Helle Variante hochladen"
		entfernenAktion="?/logoDunkelLoeschen"
		entfernenText="Helle Variante entfernen"
		ding="Helle Variante"
		warnung="Die helle Variante wird entfernt. Die Seitenleiste der App zeigt dann das normale Logo auf einem weißen Feld."
		fehler={logoDunkelFehler}
		meldung={form && 'logoGespeichert' in form && form.logoGespeichert === 'dunkel' ? 'Helle Variante gespeichert.' : null}
	>
		{#snippet vorschau()}
			<div class="bk-logo bk-logo-dunkel">
				{#if p.hatLogoDunkel}<img src={logoDunkelUrl} alt="Logo für dunklen Hintergrund" />{:else}<p class="kd-leer">Noch keine helle Variante hinterlegt.</p>{/if}
			</div>
		{/snippet}
	</DateiFeld>

	<div class="bk-h2info"><h2 id="hausfarbe">Hausfarbe</h2><InfoFenster id="briefkopf.hausfarbe" /></div>
	<p class="kd-info">
		Knöpfe, Links und der aktive Menüpunkt nutzen die Hausfarbe. Beim Hochladen des Logos wird seine Farbe automatisch
		erkannt und übernommen – solange du keine eigene Farbe gewählt hast. Die Schrift auf Knöpfen wird so gewählt, dass sie
		gut lesbar bleibt.
	</p>
	<div class="bk-farbvorschau" style={farbStil(p.farbe)} aria-label="Vorschau der Hausfarbe">
		<span class="bk-muster" style:background={p.farbe ?? STANDARD_FARBE}></span>
		<span>
			<strong>{p.farbe ?? `${STANDARD_FARBE} (Standard)`}</strong><br />
			<span class="kd-info">
				{#if !p.farbeEigen && p.logoFarbe}aus dem Logo erkannt{:else if p.farbeEigen && p.farbe}eigene Farbe{:else}Standard{/if}
				{#if p.logoFarbe} · Logo-Farbe: {p.logoFarbe}{:else if p.hatLogo} · im Logo keine eindeutige Farbe gefunden{/if}
			</span>
		</span>
		<span class="bk-beispiel" data-testid="farb-beispiel">Beispiel-Knopf</span>
	</div>
	{#if form && 'farbeFehler' in form && 'fehler' in form}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	<div class="bk-farbknoepfe">
		{#if p.logoFarbe && (p.farbeEigen || p.farbe !== p.logoFarbe)}
			<form method="POST" action="?/hausfarbe" use:enhance>
				<input type="hidden" name="wahl" value="logo" />
				<button type="submit" class="kd-knopf hell">Farbe aus dem Logo übernehmen</button>
			</form>
		{/if}
		{#if p.farbe}
			<form method="POST" action="?/hausfarbe" use:enhance>
				<input type="hidden" name="wahl" value="standard" />
				<button type="submit" class="kd-knopf hell" use:rueckfrage={{ frage: 'Hausfarbe wirklich auf Standard zurücksetzen?', ja: 'Zurücksetzen' }}>Zurücksetzen auf Standard</button>
			</form>
		{/if}
	</div>
	<p class="kd-info">Eine eigene Farbe wählst du unten bei „Angaben“ (Hausfarbe) und speicherst.</p>

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
			Hausfarbe (App, Online-Buchung, Kundenportal) – eigene Farbe wählen
			<input type="color" name="farbe" value={werte.farbe || STANDARD_FARBE} />
		</label>
		<div class="bk-portal" role="group" aria-labelledby="bk-portal-titel">
			<div class="bk-h2info"><h2 id="bk-portal-titel">Erscheinungsbild Kundenportal</h2><InfoFenster id="portal.erscheinungsbild" /></div>
			<p class="kd-info">So sieht das Portal für Ihre Kunden aus – passend zu Ihrer Website. Die CRM-App selbst nutzt nur die Hausfarbe.</p>
			<p class="kd-info">
				Im Kundenportal wird das normale Logo verwendet, groß und ohne Feld, daneben „Ihr Kundenportal“. Nur bei einer dunklen
				Kopffarbe nimmt das Portal automatisch die <a href="#logo-dunkel-titel">helle Variante</a>. Firmenname, Telefon und E-Mail
				stehen in der Kontakt-Karte darunter.
			</p>
			<div class="kd-zwei">
				<label class="bk-farbe">Farbe des Kopfs <input type="color" name="dunkelFarbe" value={werte.dunkelFarbe || '#2d2c2e'} /></label>
				<label class="bk-farbe">Hintergrund <input type="color" name="hintergrundFarbe" value={werte.hintergrundFarbe || '#f6f4f0'} /></label>
			</div>
			<div class="kd-zwei">
				<label>Schrift für Überschriften
					<Auswahl name="titelSchrift">
						<option value="montserrat" selected={(werte.titelSchrift ?? 'montserrat') === 'montserrat'}>Montserrat</option>
						<option value="inter" selected={werte.titelSchrift === 'inter'}>Inter</option>
					</Auswahl>
				</label>
				<label>Schrift für Text
					<Auswahl name="textSchrift">
						<option value="inter" selected={(werte.textSchrift ?? 'inter') === 'inter'}>Inter</option>
						<option value="opensans" selected={werte.textSchrift === 'opensans'}>Open Sans</option>
					</Auswahl>
				</label>
			</div>
			<label>Überschriften
				<Auswahl name="titelGross">
					<option value="nein" selected={werte.titelGross !== 'ja'}>normale Schreibweise</option>
					<option value="ja" selected={werte.titelGross === 'ja'}>GROSSBUCHSTABEN (wie viele Handwerker-Websites)</option>
				</Auswahl>
			</label>
		</div>
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
	.bk-h2info {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.bk-h2info :global(h2) {
		margin: 0;
	}
	.bk-portal {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
	}
	.bk-portal h2 {
		margin: 0;
		font-size: 1rem;
	}
	.bk-portal .kd-info {
		margin: 0;
	}
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
		border: 1px dashed var(--ui-rand);
		border-radius: 0.5rem;
		background: #fff;
	}
	.bk-logo img {
		max-height: 6rem;
		max-width: 100%;
		object-fit: contain;
	}
	.bk-logo-dunkel {
		background: var(--ui-nav, #2d2c2e); /* wie die Kopfleiste (msg 3319) */
	}
	.bk-logo-dunkel .kd-leer {
		color: #fff;
	}
	.bk-farbvorschau {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		margin-bottom: 0.5rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: #fff;
	}
	.bk-muster {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 8px;
		border: 1px solid var(--rand);
		flex-shrink: 0;
	}
	.bk-beispiel {
		margin-left: auto;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font-weight: 600;
	}
	.bk-farbknoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.bk-ok {
		color: #1b6b2a;
		margin: 0 0 0.5rem;
	}
</style>
