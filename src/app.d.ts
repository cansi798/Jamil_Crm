// Siehe https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	/** Angemeldeter Benutzer, wie ihn `app.sitzung_pruefen` liefert. */
	type Nutzer = {
		id: string;
		/** `null` nur bei Plattform-Admins. */
		betriebId: string | null;
		istAdmin: boolean;
		rechte: string[];
		/** Abo-Status des Betriebs, `null` bei Plattform-Admins. */
		betriebStatus: string | null;
	};

	namespace App {
		// interface Error {}
		interface Locals {
			nutzer: Nutzer | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
