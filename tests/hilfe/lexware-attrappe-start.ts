import { starteAttrappe } from './lexware-attrappe';

/**
 * Lexware-Attrappe als eigener Prozess für Browser-Tests gegen einen Probe-Server (nie gegen die Vorschau):
 *   npx tsx tests/hilfe/lexware-attrappe-start.ts 3901
 * Der Probe-Server läuft dann mit CRM_TESTMODUS=1 und CRM_LEXWARE_URL=http://127.0.0.1:3901.
 */
const a = await starteAttrappe(Number(process.argv[2] ?? 3901));
console.log(`Lexware-Attrappe auf ${a.url}`);
