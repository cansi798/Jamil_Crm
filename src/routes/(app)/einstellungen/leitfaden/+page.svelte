<script lang="ts">
	/**
	 * Leitfaden beim Termin – Einstellungen (Jamil msgs 4302/4304; 4340: 1c je Terminart, 3a einer je Firma).
	 * Ein/aus, bei welchen Terminen er erscheint, Schritte bearbeiten (Reihenfolge, Pflicht, Art). Gespeichert wird alles
	 * zusammen; laufende Leitfäden behalten ihre Schritte, Änderungen gelten für neue Termine.
	 */
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import { rueckfrage } from '$lib/rueckfrage';
	import { EINSATZ_ARTEN, EINSATZ_ART_NAMEN } from '$lib/einsatz-art';
	import {
		ANTWORT_ARTEN,
		ANTWORT_ART_NAMEN,
		KUNDEN_FELDER,
		KUNDEN_FELD_NAMEN,
		neueSchrittId,
		SCHRITT_TYPEN,
		SCHRITT_TYP_NAMEN,
		STARTVORLAGE,
		type Schritt,
		type SchrittTyp
	} from '$lib/leitfaden';
	import '$lib/stil/kunden.css';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// svelte-ignore state_referenced_locally
	let schritte = $state<Schritt[]>(structuredClone(data.einstellung.schritte));
	let neuerTyp = $state<SchrittTyp>('frage');

	function hinzufuegen() {
		const s: Schritt = { id: neueSchrittId(schritte.map((x) => x.id), neuerTyp), typ: neuerTyp, titel: '', pflicht: false };
		if (neuerTyp === 'frage') s.antwortArt = 'text';
		if (neuerTyp === 'kundendaten') s.feld = 'email';
		if (neuerTyp === 'foto') s.mindestens = 1;
		if (neuerTyp === 'protokoll' && data.protokollVorlagen[0]) {
			s.vorlageGruppe = data.protokollVorlagen[0].gruppeId;
			s.vorlageName = data.protokollVorlagen[0].name;
			s.titel = data.protokollVorlagen[0].name;
		}
		schritte = [...schritte, s];
	}
	function verschiebe(i: number, d: -1 | 1) {
		const j = i + d;
		if (j < 0 || j >= schritte.length) return;
		const neu = [...schritte];
		[neu[i], neu[j]] = [neu[j], neu[i]];
		schritte = neu;
	}
	const optionenText = (s: Schritt) => (s.optionen ?? []).join('\n');
</script>

<svelte:head>
	<title>Leitfaden beim Termin</title>
</svelte:head>

<main class="kd-seite lf-einst">
	<h1>Leitfaden beim Termin</h1>
	<p class="kd-info lf-intro">
		Beim Termin (z. B. Besichtigung) arbeitet die eingeteilte Person den Leitfaden auf EINER Seite durch. Was sie dort einträgt,
		landet von selbst in der Kundenakte, bei den Dokumenten, Aufgaben und Notizen des Auftrags. Fehlen Pflichtschritte, geht
		Abschließen nur mit Begründung – das Büro bekommt dann einen Hinweis.
		<InfoFenster id="leitfaden.seite" />
	</p>

	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.gespeichert}<p role="status" class="lf-meldung">Gespeichert. Neue Termine bekommen ab jetzt diesen Leitfaden.</p>{/if}

	<form id="lf-form" method="POST" action="?/speichern" use:enhance={() => async ({ update }) => update({ reset: false })} class="lf-form">
		<input type="hidden" name="schritte" value={JSON.stringify(schritte)} />

		<Abschnitt titel="Ein / Aus" info="leitfaden.aktiv">
			{#snippet aktionen()}<button type="submit" class="kd-knopf klein" data-testid="leitfaden-speichern">Speichern</button>{/snippet}
			<div class="lf-felder">
				<Schalter name="aktiv" an={data.einstellung.aktiv} label="Leitfaden einschalten" hinweis="Aus = bei keinem Termin, bisherige Leitfäden bleiben am Auftrag." />
				<label class="lf-feld">Name <input type="text" name="name" maxlength="100" required value={data.einstellung.name} /></label>
			</div>
		</Abschnitt>

		<Abschnitt titel="Bei welchen Terminen?" info="leitfaden.gilt_fuer">
			<div class="lf-haken-liste" role="group" aria-label="Termin-Arten">
				{#each EINSATZ_ARTEN as art (art)}
					<label class="kd-haken"><input type="checkbox" name="arten" value={art} checked={data.einstellung.arten.includes(art)} /> <span>{EINSATZ_ART_NAMEN[art]}</span></label>
				{/each}
			</div>
			{#if data.terminarten.length > 0}
				<p class="kd-info">Terminarten aus <a href="/einstellungen/terminarten">Anfrage → Terminarten</a>:</p>
				<div class="lf-haken-liste" role="group" aria-label="Terminarten">
					{#each data.terminarten as t (t.id)}
						<label class="kd-haken">
							<input type="checkbox" name="terminarten" value={t.id} checked={data.einstellung.terminarten.includes(t.id)} />
							<span><span class="lf-farbe" style:background={t.farbe} aria-hidden="true"></span>{t.name}{t.aktiv ? '' : ' (ausgeschaltet)'}</span>
						</label>
					{/each}
				</div>
			{/if}
		</Abschnitt>

		<Abschnitt titel="Schritte" anzahl={schritte.length} info="leitfaden.schritte">
			{#snippet aktionen()}
				<button type="button" class="kd-knopf hell klein" use:rueckfrage={{ frage: 'Alle Schritte durch die Startvorlage ersetzen?', ja: 'Ersetzen' }} onclick={() => (schritte = structuredClone(STARTVORLAGE))}>Startvorlage</button>
			{/snippet}
			<ol class="lf-liste" aria-label="Schritte">
				{#each schritte as s, i (s.id)}
					<li class="lf-zeile" data-testid="leitfaden-schritt">
						<div class="lf-zeile-kopf">
							<span class="lf-nr">{i + 1}</span>
							<span class="ah-chip">{SCHRITT_TYP_NAMEN[s.typ]}</span>
							<span class="lf-knoepfe">
								<button type="button" class="kd-knopf hell klein" aria-label={`Schritt ${i + 1} nach oben`} disabled={i === 0} onclick={() => verschiebe(i, -1)}>↑</button>
								<button type="button" class="kd-knopf hell klein" aria-label={`Schritt ${i + 1} nach unten`} disabled={i === schritte.length - 1} onclick={() => verschiebe(i, 1)}>↓</button>
								<button type="button" class="kd-knopf gefahr klein" use:rueckfrage={{ frage: `Schritt „${s.titel || i + 1}“ entfernen?`, ja: 'Entfernen' }} onclick={() => (schritte = schritte.filter((x) => x.id !== s.id))}>Entfernen</button>
							</span>
						</div>
						<label class="lf-feld">Titel <input type="text" maxlength="200" bind:value={s.titel} required placeholder="z. B. Was genau soll gemacht werden?" /></label>
						<label class="lf-feld">Hilfetext (optional) <input type="text" maxlength="500" value={s.hilfe ?? ''} oninput={(ev) => (s.hilfe = ev.currentTarget.value)} /></label>
						{#if s.typ === 'frage'}
							<label class="lf-feld">Antwort
								<Auswahl value={s.antwortArt ?? 'text'} onchange={(ev) => (s.antwortArt = ev.currentTarget.value as Schritt['antwortArt'])}>
									{#each ANTWORT_ARTEN as a (a)}<option value={a} selected={(s.antwortArt ?? 'text') === a}>{ANTWORT_ART_NAMEN[a]}</option>{/each}
								</Auswahl>
							</label>
							{#if s.antwortArt === 'auswahl'}
								<label class="lf-feld">Antworten (eine pro Zeile) <textarea rows="3" value={optionenText(s)} oninput={(ev) => (s.optionen = ev.currentTarget.value.split('\n'))}></textarea></label>
							{/if}
						{:else if s.typ === 'kundendaten'}
							<label class="lf-feld">Welche Kundendaten?
								<Auswahl value={s.feld ?? 'email'} onchange={(ev) => (s.feld = ev.currentTarget.value as Schritt['feld'])}>
									{#each KUNDEN_FELDER as f (f)}<option value={f} selected={s.feld === f}>{KUNDEN_FELD_NAMEN[f]}</option>{/each}
								</Auswahl>
							</label>
						{:else if s.typ === 'foto'}
							<label class="lf-feld lf-schmal">Mindestens so viele Fotos <input type="number" min="1" max="20" value={s.mindestens ?? 1} oninput={(ev) => (s.mindestens = Number(ev.currentTarget.value))} /></label>
						{:else if s.typ === 'protokoll'}
							{#if data.protokollVorlagen.length === 0}
								<p class="kd-info">Noch keine Protokoll-Vorlage – bitte zuerst unter <a href="/einstellungen/protokoll-vorlagen">Vorlagen → Protokoll- & Aufmaß-Vorlagen</a> anlegen.</p>
							{:else}
								<label class="lf-feld">Protokoll-Vorlage
									<Auswahl
										value={s.vorlageGruppe ?? ''}
										onchange={(ev) => {
											const v = data.protokollVorlagen.find((x) => x.gruppeId === ev.currentTarget.value);
											s.vorlageGruppe = v?.gruppeId;
											s.vorlageName = v?.name;
										}}
									>
										<option value="" selected={!s.vorlageGruppe}>– bitte wählen –</option>
										{#each data.protokollVorlagen as v (v.gruppeId)}<option value={v.gruppeId} selected={s.vorlageGruppe === v.gruppeId}>{v.name}</option>{/each}
									</Auswahl>
								</label>
								<p class="kd-info">Wird im Leitfaden ausgefüllt (Pflichtfelder, Fotos, Unterschrift) und beim Abschluss als PDF in den Dokumenten des Auftrags gespeichert.</p>
							{/if}
						{:else if s.typ === 'aufgabe'}
							<label class="lf-feld">Vorschlag für die Aufgabe <input type="text" maxlength="200" value={s.aufgabeTitel ?? ''} oninput={(ev) => (s.aufgabeTitel = ev.currentTarget.value)} placeholder="z. B. Angebot erstellen" /></label>
						{/if}
						{#if s.typ !== 'hinweis'}
							<label class="kd-haken"><input type="checkbox" checked={s.pflicht} onchange={(ev) => (s.pflicht = ev.currentTarget.checked)} /> <span>Pflicht</span></label>
						{/if}
					</li>
				{/each}
			</ol>
			<div class="lf-neu">
				<label class="lf-feld">Neuer Schritt
					<Auswahl value={neuerTyp} onchange={(ev) => (neuerTyp = ev.currentTarget.value as SchrittTyp)} aria-label="Art des neuen Schritts">
						{#each SCHRITT_TYPEN as t (t)}<option value={t} selected={neuerTyp === t}>{SCHRITT_TYP_NAMEN[t]}</option>{/each}
					</Auswahl>
				</label>
				<button type="button" class="kd-knopf hell" onclick={hinzufuegen}>+ Schritt hinzufügen</button>
			</div>
		</Abschnitt>

		<div class="lf-fuss"><button type="submit" class="kd-knopf">Speichern</button></div>
	</form>
</main>

<style>
	.lf-intro { max-width: 60rem; }
	.lf-form { display: grid; gap: var(--ui-a3, 0.75rem); }
	.lf-felder { display: grid; gap: 0.75rem; max-width: 36rem; }
	.lf-feld { display: grid; gap: 0.25rem; font-size: var(--ui-schrift-s, 0.875rem); }
	.lf-schmal { max-width: 14rem; }
	.lf-haken-liste { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; }
	.lf-farbe { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 50%; margin-right: 0.35rem; vertical-align: middle; }
	.lf-liste { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
	.lf-zeile { display: grid; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--ui-rand); border-radius: var(--ui-radius-karte, 12px); background: var(--ui-flaeche); }
	.lf-zeile-kopf { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
	.lf-nr { display: grid; place-items: center; width: 1.7rem; height: 1.7rem; border-radius: 50%; background: var(--ui-grau-hell); font-weight: 700; font-size: 0.8rem; }
	.lf-knoepfe { display: flex; gap: 0.3rem; margin-left: auto; }
	.lf-neu { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; margin-top: 0.75rem; }
	.lf-neu .lf-feld { min-width: 15rem; }
	.lf-fuss { display: flex; justify-content: flex-end; }
	.lf-meldung { margin: 0; padding: var(--ui-a2) var(--ui-a3); border-radius: var(--ui-radius); background: var(--ui-gruen-hell); color: var(--ui-gruen); font-weight: 600; }
	@media (max-width: 480px) {
		.lf-knoepfe { margin-left: 0; width: 100%; }
	}
</style>
