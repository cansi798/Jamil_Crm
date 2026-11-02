<script lang="ts">
	/**
	 * Leitfaden beim Termin – EINE Fläche (Jamil msg 4304): Der Experte trägt hier alles ein; das CRM legt es selbst in
	 * Kundenakte (E-Mail, Telefon, Kontaktweg, Adresse), Dokumenten (Fotos), Aufgaben, Notizen und Verlauf ab.
	 * Jede Eingabe geht über den Ausgang (`leitfaden-ausgang.ts`): sofort gemerkt, dann gesendet – ohne Netz später
	 * (4b). Abschließen nur mit allen Pflichtschritten oder mit Begründung (2b). Läuft online (/leitfaden/…) und auf der
	 * Offline-Seite mit der Kopie von „Meine Einsätze heute“.
	 */
	import { onMount } from 'svelte';
	import { berlinUhrzeit, berlinTag, tagDeutsch } from '$lib/zeit';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import KontaktwegSymbol from '$lib/components/ui/KontaktwegSymbol.svelte';
	import Assistent from '$lib/components/protokoll/Assistent.svelte';
	import { istKontaktweg, KONTAKTWEG_OPTIONEN } from '$lib/kontaktweg';
	import { verkleinereFoto } from '$lib/bild-verkleinern';
	import {
		fehlendePflicht,
		fortschritt,
		istErledigt,
		kundenWert,
		kundenWertText,
		STATUS_NAMEN,
		uebernimm,
		type Adresse,
		type Antworten,
		type AufgabeWert,
		type LeitfadenKunde,
		type LeitfadenProtokolle,
		type LeitfadenStatus,
		type ProtokollEingabe,
		type Schritt
	} from '$lib/leitfaden';
	import { einreihen, fehlerListe, fehlerVerwerfen, neueOpId, senden, wartend, zuruecknehmen, type AusgangFehler, type AusgangOp } from '$lib/leitfaden-ausgang';

	export type FlaecheStand = {
		einsatzId: string;
		name: string;
		kundeName: string;
		auftragNummer: string;
		auftragTitel: string;
		terminBeginn: string | null;
		schritte: Schritt[];
		antworten: Antworten;
		kunde: LeitfadenKunde | null;
		/** Protokolle der Schritte „Protokoll ausfüllen“ (Jamil msg 4353) */
		protokolle?: LeitfadenProtokolle;
		status: LeitfadenStatus;
		begruendung: string | null;
	};

	let { stand, offline = false, onstand }: { stand: FlaecheStand; offline?: boolean; onstand?: (s: FlaecheStand) => void } = $props();

	// letzter Stand vom Server (bzw. aus der Offline-Kopie) + noch nicht gesendete Eingaben = was der Experte sieht
	// svelte-ignore state_referenced_locally
	let server = $state<FlaecheStand>(stand);
	let ops = $state<AusgangOp[]>([]);
	let fehler = $state<AusgangFehler[]>([]);
	// svelte-ignore state_referenced_locally
	let ohneNetz = $state(offline);
	let meldung = $state<string | null>(null);
	let begruendung = $state('');
	let fotoLaeuft = $state<string | null>(null);

	const einsatzId = $derived(server.einsatzId);
	const pendingAbschluss = $derived(ops.some((o) => o.art === 'abschluss'));
	const sicht = $derived.by(() => {
		let antworten = server.antworten;
		const kunde: LeitfadenKunde | null = server.kunde ? { ...server.kunde } : null;
		// Protokolle: wartende Eingaben schon anzeigen (Werte, Fotos und Unterschriften „wartet“)
		const protokolle: LeitfadenProtokolle = {};
		for (const [id, p] of Object.entries(server.protokolle ?? {})) protokolle[id] = p ? { ...p, antworten: { ...p.antworten } } : null;
		for (const o of ops) {
			const p = 'schrittId' in o ? protokolle[o.schrittId] : null;
			if (p && o.art === 'eingabe') {
				const pe = o.wert as ProtokollEingabe;
				p.antworten[pe.feld] = pe.wert;
				continue;
			}
			if (p && o.art === 'foto' && o.feld) {
				const bisher = Array.isArray(p.antworten[o.feld]) ? (p.antworten[o.feld] as string[]) : [];
				p.antworten[o.feld] = [...bisher, `wartet:${o.opId}`];
				continue;
			}
			if (p && o.art === 'unterschrift') {
				p.antworten[o.feld] = { dateiId: `wartet:${o.opId}`, name: o.name, zeit: o.zeit };
				continue;
			}
			if (o.art === 'eingabe') {
				antworten = uebernimm(antworten, o.schrittId, o.wert, o.zeit).antworten;
				const s = server.schritte.find((x) => x.id === o.schrittId);
				if (s?.typ === 'kundendaten' && kunde) {
					if (s.feld === 'adresse') Object.assign(kunde, o.wert as Adresse);
					else (kunde as Record<string, unknown>)[s.feld!] = o.wert === '' ? null : o.wert;
				}
			}
			if (o.art === 'foto') {
				const bisher = Array.isArray(antworten[o.schrittId]?.wert) ? (antworten[o.schrittId].wert as string[]) : [];
				antworten = { ...antworten, [o.schrittId]: { wert: [...bisher, `wartet:${o.opId}`], zeit: o.zeit } };
			}
		}
		return { antworten, kunde, protokolle };
	});
	const fehlend = $derived(fehlendePflicht(server.schritte, sicht.antworten, sicht.kunde, sicht.protokolle));
	const stand_ = $derived(fortschritt(server.schritte, sicht.antworten, sicht.kunde, sicht.protokolle));
	const fertig = $derived(server.status !== 'offen' || pendingAbschluss);

	function auffrischen() {
		ops = wartend(einsatzId);
		fehler = fehlerListe(einsatzId);
	}

	async function schicken() {
		const r = await senden();
		const neu = r.staende.get(einsatzId) as (FlaecheStand & { id?: string }) | null | undefined;
		if (neu && Array.isArray(neu.schritte)) {
			server = { ...server, antworten: neu.antworten, kunde: neu.kunde, protokolle: neu.protokolle ?? server.protokolle, status: neu.status, begruendung: neu.begruendung };
			onstand?.(server);
		}
		ohneNetz = r.offline;
		auffrischen();
	}

	function merke(op: AusgangOp): boolean {
		if (!einreihen(op)) {
			meldung = 'Das konnte auf dem Gerät nicht gespeichert werden (Speicher voll). Bitte bei Netz erneut versuchen.';
			return false;
		}
		meldung = null;
		auffrischen();
		void schicken();
		return true;
	}

	function eingeben(s: Schritt, wert: unknown) {
		merke({ art: 'eingabe', opId: neueOpId(), einsatzId, schrittId: s.id, wert, zeit: new Date().toISOString() });
	}

	async function foto(s: Schritt, ev: Event) {
		const feld = ev.currentTarget as HTMLInputElement;
		const datei = feld.files?.[0];
		feld.value = '';
		if (!datei) return;
		fotoLaeuft = s.id;
		try {
			const { blob, typ } = await verkleinereFoto(datei, 1600);
			const daten = await new Promise<string>((ok, nein) => {
				const r = new FileReader();
				r.onload = () => ok(String(r.result));
				r.onerror = () => nein(r.error);
				r.readAsDataURL(blob);
			});
			merke({ art: 'foto', opId: neueOpId(), einsatzId, schrittId: s.id, zeit: new Date().toISOString(), daten, typ });
		} catch (e) {
			meldung = (e as Error).message;
		} finally {
			fotoLaeuft = null;
		}
	}

	function abschliessen() {
		alleWartendenMerken();
		if (fehlend.length > 0 && begruendung.trim() === '') {
			meldung = 'Es fehlen noch Pflichtschritte – bitte kurz begründen, warum.';
			return;
		}
		merke({ art: 'abschluss', opId: neueOpId(), einsatzId, zeit: new Date().toISOString(), begruendung: fehlend.length > 0 ? begruendung.trim() : '' });
	}

	// ——— Protokoll im Leitfaden (Jamil msg 4353) ———
	// Texte nicht bei jedem Tastendruck senden: je Feld kurz warten, dann EINE Eingabe
	const warten = new Map<string, { timer: ReturnType<typeof setTimeout>; los: () => void }>();
	function protokollWert(s: Schritt, feld: string, w: unknown) {
		const schluessel = `${s.id}:${feld}`;
		const alt = warten.get(schluessel);
		if (alt) clearTimeout(alt.timer);
		const los = () => {
			warten.delete(schluessel);
			eingeben(s, { feld, wert: w });
		};
		warten.set(schluessel, { timer: setTimeout(los, typeof w === 'string' ? 700 : 0), los });
	}
	/** Beim Verlassen: noch wartende Texte sofort merken (nichts geht verloren). */
	function alleWartendenMerken() {
		for (const { timer, los } of [...warten.values()]) {
			clearTimeout(timer);
			los();
		}
	}
	const alsDaten = (blob: Blob) =>
		new Promise<string>((ok, nein) => {
			const r = new FileReader();
			r.onload = () => ok(String(r.result));
			r.onerror = () => nein(r.error);
			r.readAsDataURL(blob);
		});
	async function protokollFoto(s: Schritt, feld: string, datei: File) {
		const { blob, typ } = await verkleinereFoto(datei, 1600);
		if (!merke({ art: 'foto', opId: neueOpId(), einsatzId, schrittId: s.id, feld, zeit: new Date().toISOString(), daten: await alsDaten(blob), typ })) throw new Error(meldung ?? 'Speicher voll');
	}
	async function protokollFotoLoeschen(s: Schritt, id: string) {
		if (id.startsWith('wartet:')) {
			zuruecknehmen(id.slice(7));
			auffrischen();
			return;
		}
		const pid = server.protokolle?.[s.id]?.id;
		const r = await fetch(`/api/protokoll-formulare/${pid}/dateien/${id}`, { method: 'DELETE' }).catch(() => null);
		if (!r?.ok) throw new Error('Entfernen geht nur mit Netz – bitte später nochmal.');
		const neu = await fetch(`/api/leitfaden/${einsatzId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
		if (neu) server = { ...server, protokolle: neu.protokolle };
	}
	async function protokollUnterschrift(s: Schritt, feld: string, png: Uint8Array, name: string) {
		const daten = await alsDaten(new Blob([png as BlobPart], { type: 'image/png' }));
		if (!merke({ art: 'unterschrift', opId: neueOpId(), einsatzId, schrittId: s.id, feld, name, zeit: new Date().toISOString(), daten })) throw new Error(meldung ?? 'Speicher voll');
	}
	const protokollFotoUrl = (s: Schritt) => (id: string) => (id.startsWith('wartet:') ? null : `/api/protokoll-formulare/${server.protokolle?.[s.id]?.id}/dateien/${id}`);

	onMount(() => {
		auffrischen();
		void schicken();
		const online = () => void schicken();
		window.addEventListener('online', online);
		window.addEventListener('pagehide', alleWartendenMerken);
		return () => {
			alleWartendenMerken();
			window.removeEventListener('online', online);
			window.removeEventListener('pagehide', alleWartendenMerken);
		};
	});

	const wert = (s: Schritt) => sicht.antworten[s.id]?.wert;
	const textWert = (s: Schritt) => (typeof wert(s) === 'string' ? (wert(s) as string) : '');
	const aufgabe = (s: Schritt): AufgabeWert => (wert(s) as AufgabeWert) ?? { anlegen: false, titel: s.aufgabeTitel ?? s.titel };
	const adresse = (): Adresse => ({ strasse: sicht.kunde?.strasse ?? '', plz: sicht.kunde?.plz ?? '', ort: sicht.kunde?.ort ?? '' });
	const fotos = (s: Schritt) => (Array.isArray(wert(s)) ? (wert(s) as string[]) : []);
	const wann = $derived(server.terminBeginn ? `${tagDeutsch(berlinTag(new Date(server.terminBeginn)))}, ${berlinUhrzeit(new Date(server.terminBeginn))} Uhr` : '');
	const titelVon = (opId: string) => server.schritte.find((s) => s.id === (fehler.find((f) => f.op.opId === opId)?.op as { schrittId?: string })?.schrittId)?.titel;
</script>

<section class="lf" data-testid="leitfaden" aria-label={server.name}>
	<header class="lf-kopf">
		<p class="lf-ueber">{server.name}</p>
		<h2 class="lf-kunde">{server.kundeName || 'Ohne Kunde'}</h2>
		<p class="kd-info">{server.auftragNummer} · {server.auftragTitel}{wann ? ` · ${wann}` : ''}</p>
		<div class="lf-balken" role="progressbar" aria-label="Fortschritt" aria-valuemin="0" aria-valuemax={stand_.gesamt} aria-valuenow={stand_.erledigt}>
			<span style:width={`${stand_.gesamt ? (stand_.erledigt / stand_.gesamt) * 100 : 0}%`}></span>
		</div>
		<p class="lf-zahl" data-testid="leitfaden-fortschritt">{stand_.erledigt} von {stand_.gesamt} erledigt{fehlend.length ? ` · ${fehlend.length} Pflicht offen` : ''}</p>
		{#if ohneNetz || ops.length > 0}
			<p class="lf-netz" role="status" data-testid="leitfaden-wartet">
				{`${ohneNetz ? 'Kein Netz – ' : ''}${ops.length} ${ops.length === 1 ? 'Eingabe wartet' : 'Eingaben warten'} auf das Senden${ohneNetz ? ` und ${ops.length === 1 ? 'geht' : 'gehen'} automatisch raus, sobald wieder Netz da ist.` : ' …'}`}
			</p>
		{/if}
		{#if server.status !== 'offen'}
			<p class="lf-fertig" role="status" data-testid="leitfaden-status">✓ {STATUS_NAMEN[server.status]}{server.begruendung ? ` – Begründung: ${server.begruendung}` : ''}</p>
		{:else if pendingAbschluss}
			<p class="lf-fertig" role="status" data-testid="leitfaden-status">✓ Abschluss gespeichert – wird gesendet</p>
		{/if}
	</header>

	{#each fehler as f (f.op.opId)}
		<p class="kd-fehler lf-fehler" role="alert">
			Nicht übernommen{titelVon(f.op.opId) ? ` („${titelVon(f.op.opId)}“)` : ''}: {f.meldung}
			<button type="button" class="kd-knopf hell klein" onclick={() => { fehlerVerwerfen(f.op.opId); auffrischen(); }}>Verstanden</button>
		</p>
	{/each}
	{#if meldung}<p class="kd-fehler" role="alert">{meldung}</p>{/if}

	<ol class="lf-schritte">
		{#each server.schritte as s, i (s.id)}
			{@const erledigt = istErledigt(s, sicht.antworten[s.id], sicht.kunde, sicht.protokolle)}
			<li class="lf-schritt" class:erledigt class:pflicht-offen={s.pflicht && !erledigt} data-testid={`schritt-${s.id}`}>
				<div class="lf-schritt-kopf">
					<span class="lf-marke" aria-hidden="true">{erledigt ? '✓' : i + 1}</span>
					<div>
						<h3>{s.titel}{#if s.pflicht}<span class="lf-pflicht" title="Pflicht"> *</span>{/if}</h3>
						{#if s.hilfe}<p class="kd-info">{s.hilfe}</p>{/if}
					</div>
				</div>

				{#if s.typ === 'kundendaten'}
					{@const vorhanden = kundenWert(s.feld!, sicht.kunde)}
					{#if !sicht.kunde}
						<p class="kd-info">Der Auftrag hat keinen Kunden aus der Kundendatenbank.</p>
					{:else if s.feld === 'bevorzugter_kontakt'}
						<div class="lf-kw">
						<Segmente label={s.titel} wert={istKontaktweg(vorhanden) ? vorhanden : ''} optionen={KONTAKTWEG_OPTIONEN} onchange={(w) => !fertig && eingeben(s, w)}>
							{#snippet symbol(w)}<KontaktwegSymbol weg={istKontaktweg(w) ? w : ''} groesse={15} />{/snippet}
						</Segmente>
						</div>
					{:else if s.feld === 'adresse'}
						{@const a = adresse()}
						<form class="lf-adresse" onsubmit={(ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); eingeben(s, { strasse: f.get('strasse'), plz: f.get('plz'), ort: f.get('ort') }); }}>
							<label>Straße <input name="strasse" value={a.strasse} disabled={fertig} autocomplete="street-address" /></label>
							<label>PLZ <input name="plz" value={a.plz} disabled={fertig} autocomplete="postal-code" /></label>
							<label>Ort <input name="ort" value={a.ort} disabled={fertig} autocomplete="address-level2" /></label>
							{#if !fertig}<button type="submit" class="kd-knopf hell">Adresse speichern</button>{/if}
						</form>
					{:else}
						<label class="lf-feld">
							{s.feld === 'email' ? 'E-Mail-Adresse' : 'Telefonnummer'}
							<input
								type={s.feld === 'email' ? 'email' : 'tel'}
								value={typeof vorhanden === 'string' ? vorhanden : ''}
								disabled={fertig}
								autocomplete={s.feld === 'email' ? 'email' : 'tel'}
								onchange={(ev) => eingeben(s, ev.currentTarget.value)}
							/>
						</label>
					{/if}
					{#if sicht.kunde}<p class="lf-ziel">{vorhanden ? `✓ Steht in der Kundenakte: ${kundenWertText(s.feld!, vorhanden)}` : '→ wird in der Kundenakte gespeichert'}</p>{/if}
				{:else if s.typ === 'frage'}
					{#if s.antwortArt === 'janein'}
						<Segmente label={s.titel} wert={textWert(s)} optionen={[{ wert: 'ja', text: 'Ja' }, { wert: 'nein', text: 'Nein' }]} onchange={(w) => !fertig && eingeben(s, w)} />
					{:else if s.antwortArt === 'auswahl'}
						<Auswahl aria-label={s.titel} value={textWert(s)} disabled={fertig} onchange={(ev) => eingeben(s, ev.currentTarget.value)}>
							<option value="">– bitte wählen –</option>
							{#each s.optionen ?? [] as o (o)}<option value={o} selected={textWert(s) === o}>{o}</option>{/each}
						</Auswahl>
					{:else}
						<textarea aria-label={s.titel} rows="3" maxlength="2000" disabled={fertig} value={textWert(s)} onchange={(ev) => eingeben(s, ev.currentTarget.value)}></textarea>
					{/if}
					<p class="lf-ziel">→ kommt ins Ergebnis am Auftrag</p>
				{:else if s.typ === 'notiz'}
					<textarea aria-label={s.titel} rows="3" maxlength="2000" disabled={fertig} value={textWert(s)} onchange={(ev) => eingeben(s, ev.currentTarget.value)}></textarea>
					<p class="lf-ziel">→ kommt in die Notiz am Auftrag</p>
				{:else if s.typ === 'abhaken'}
					<label class="lf-haken">
						<input type="checkbox" checked={wert(s) === true} disabled={fertig} onchange={(ev) => eingeben(s, ev.currentTarget.checked)} />
						<span>Erledigt</span>
					</label>
				{:else if s.typ === 'foto'}
					<p class="lf-fotos" data-testid={`fotos-${s.id}`}>
						{fotos(s).length} von mindestens {s.mindestens ?? 1} Foto(s){fotos(s).some((f) => f.startsWith('wartet:')) ? ' (teils noch nicht gesendet)' : ''}
					</p>
					{#if !fertig}
						<label class="kd-knopf hell lf-foto-knopf">
							{fotoLaeuft === s.id ? 'Foto wird vorbereitet …' : '📷 Foto aufnehmen'}
							<input type="file" accept="image/*" capture="environment" class="lf-datei" aria-label={`Foto für „${s.titel}“`} onchange={(ev) => foto(s, ev)} />
						</label>
					{/if}
					<p class="lf-ziel">→ landet bei den Dokumenten des Auftrags</p>
				{:else if s.typ === 'protokoll'}
					{@const p = sicht.protokolle[s.id]}
					{#if !p}
						<p class="kd-info">Die Protokoll-Vorlage{s.vorlageName ? ` „${s.vorlageName}“` : ''} ist nicht mehr verfügbar.</p>
					{:else}
						<div class="lf-protokoll" data-testid={`protokoll-${s.id}`}>
							<Assistent
								alles
								schema={p.schema}
								antworten={p.antworten}
								gesperrt={fertig || p.status === 'abgeschlossen'}
								onwert={(f, w) => protokollWert(s, f, w)}
								fotoUrl={protokollFotoUrl(s)}
								onfoto={(f, d) => protokollFoto(s, f, d)}
								onfotoLoeschen={(_f, id) => protokollFotoLoeschen(s, id)}
								onunterschrift={(f, png, name) => protokollUnterschrift(s, f, png, name)}
							/>
						</div>
						<p class="lf-ziel">{p.status === 'abgeschlossen' ? '✓ Protokoll abgeschlossen – PDF bei den Dokumenten des Auftrags' : '→ wird beim Abschluss als PDF in den Dokumenten des Auftrags gespeichert'}</p>
					{/if}
				{:else if s.typ === 'aufgabe'}
					{@const a = aufgabe(s)}
					<label class="lf-haken">
						<input type="checkbox" checked={!!sicht.antworten[s.id] && a.anlegen} disabled={fertig} onchange={(ev) => eingeben(s, { anlegen: ev.currentTarget.checked, titel: a.titel })} />
						<span>Aufgabe anlegen</span>
					</label>
					{#if !sicht.antworten[s.id] && !fertig}
						<button type="button" class="knopf-subtil" onclick={() => eingeben(s, { anlegen: false, titel: a.titel })}>Nicht nötig</button>
					{/if}
					<label class="lf-feld">Titel der Aufgabe <input value={a.titel} maxlength="200" disabled={fertig} onchange={(ev) => eingeben(s, { anlegen: a.anlegen || !sicht.antworten[s.id], titel: ev.currentTarget.value })} /></label>
					<p class="lf-ziel">→ entsteht beim Abschluss als Aufgabe am Auftrag</p>
				{/if}
			</li>
		{/each}
	</ol>

	{#if !fertig}
		<footer class="lf-fuss" data-testid="leitfaden-abschluss">
			{#if fehlend.length > 0}
				<p class="kd-info">Noch offen (Pflicht): {fehlend.map((s) => s.titel).join(', ')}. Abschließen geht dann nur mit Begründung – das Büro bekommt einen Hinweis.</p>
				<label class="lf-feld">Begründung <textarea bind:value={begruendung} rows="2" maxlength="1000" placeholder="z. B. Kunde hatte keine E-Mail-Adresse"></textarea></label>
				<button type="button" class="kd-knopf" onclick={abschliessen}>Mit Begründung abschließen</button>
			{:else}
				<button type="button" class="kd-knopf" onclick={abschliessen}>Leitfaden abschließen ✓</button>
			{/if}
		</footer>
	{/if}
</section>

<style>
	.lf {
		display: grid;
		gap: var(--ui-a3, 0.75rem);
	}
	.lf-kopf {
		display: grid;
		gap: 0.3rem;
		position: sticky;
		top: 0;
		z-index: 2;
		padding: 0.75rem 0;
		background: var(--ui-hintergrund, #f5f3ef);
	}
	.lf-kopf p,
	.lf-kopf h2 {
		margin: 0;
	}
	.lf-ueber {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ui-akzent-text, #7a5c1e);
	}
	.lf-kunde {
		font-size: 1.3rem;
	}
	.lf-balken {
		height: 0.5rem;
		border-radius: 999px;
		background: var(--ui-grau-hell, #ebe8e2);
		overflow: hidden;
	}
	.lf-balken span {
		display: block;
		height: 100%;
		background: var(--ui-gruen, #0e700e);
		transition: width 200ms;
	}
	.lf-zahl {
		font-size: var(--ui-schrift-s, 0.875rem);
		font-weight: 600;
	}
	.lf-netz {
		padding: 0.4rem 0.6rem;
		border-radius: var(--ui-radius, 8px);
		background: #fff4ce;
		color: #6b4f00;
		font-size: var(--ui-schrift-s, 0.875rem);
	}
	.lf-fertig {
		padding: 0.4rem 0.6rem;
		border-radius: var(--ui-radius, 8px);
		background: var(--ui-gruen-hell, #dff6dd);
		color: var(--ui-gruen, #0e700e);
		font-weight: 600;
	}
	.lf-fehler {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.lf-schritte {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--ui-a2, 0.5rem);
	}
	.lf-schritt {
		display: grid;
		gap: 0.5rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--ui-rand, #e2ddd3);
		border-left: 4px solid var(--ui-rand-stark, #c9c4ba);
		border-radius: var(--ui-radius-karte, 12px);
		background: var(--ui-flaeche, #fff);
	}
	.lf-schritt.erledigt {
		border-left-color: var(--ui-gruen, #0e700e);
	}
	.lf-schritt.pflicht-offen {
		border-left-color: #c48a00;
	}
	.lf-schritt-kopf {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
	}
	.lf-schritt-kopf h3 {
		margin: 0.15rem 0 0;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}
	.lf-schritt-kopf p {
		margin: 0.15rem 0 0;
	}
	.lf-marke {
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 50%;
		background: var(--ui-grau-hell, #ebe8e2);
		font-weight: 700;
		font-size: 0.85rem;
	}
	.erledigt .lf-marke {
		background: var(--ui-gruen, #0e700e);
		color: #fff;
	}
	.lf-pflicht {
		color: #a4262c;
	}
	.lf-feld,
	.lf-adresse label {
		display: grid;
		gap: 0.25rem;
		font-size: var(--ui-schrift-s, 0.875rem);
	}
	.lf-feld input,
	.lf-adresse input,
	.lf textarea {
		min-height: var(--ui-feld-hoehe, 44px);
		width: 100%;
		box-sizing: border-box;
	}
	.lf-adresse {
		display: grid;
		gap: 0.5rem;
	}
	.lf-haken {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 44px;
		font-weight: 600;
	}
	.lf-haken input {
		width: 1.4rem;
		height: 1.4rem;
	}
	.lf-ziel {
		margin: 0;
		font-size: 0.75rem;
		color: var(--ui-text-leise, #616161);
	}
	.lf-fotos {
		margin: 0;
		font-weight: 600;
	}
	.lf-foto-knopf {
		position: relative;
		justify-self: start;
		overflow: hidden;
	}
	.lf-datei {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.lf-fuss {
		display: grid;
		gap: 0.5rem;
		padding: 0.9rem;
		border-radius: var(--ui-radius-karte, 12px);
		background: var(--ui-flaeche, #fff);
		border: 1px solid var(--ui-rand, #e2ddd3);
	}
	.lf-fuss p {
		margin: 0;
	}
	.lf-fuss .kd-knopf {
		justify-self: stretch;
	}
	.lf-kw :global(.seg-teil) {
		gap: 0.35rem;
	}
	/* Handy: vier Wege als 2 × 2-Raster wie im Kundenformular (kein Querscrollen) */
	@media (max-width: 480px) {
		:global(html body) .lf-kw :global(.seg) {
			display: grid !important;
			grid-template-columns: 1fr 1fr;
			height: auto !important;
			border-radius: 1.4rem !important;
		}
		:global(html body) .lf-kw :global(.seg .seg-teil) {
			height: 2.5rem !important;
			padding: 0 0.5rem !important;
		}
	}
	.lf-protokoll {
		padding: 0.25rem 0;
	}
	.lf-protokoll :global(.pa-titel) {
		font-size: 0.95rem;
	}
</style>
