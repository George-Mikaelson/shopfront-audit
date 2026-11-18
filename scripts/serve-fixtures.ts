// Serves a fixture site for manual testing: node scripts/serve-fixtures.ts bad 4174
import { startSite, type SiteName } from '../test/support/fixture-server.ts';

const SITES: readonly string[] = ['good', 'bad'];
const name = process.argv[2] ?? 'good';
if (!SITES.includes(name)) {
  console.error('Usage: node scripts/serve-fixtures.ts <good|bad> [port]');
  process.exit(64);
}
const site = await startSite(name as SiteName, Number(process.argv[3] ?? 0));
console.log(`${name} site at ${site.url} (Ctrl+C to stop)`);
