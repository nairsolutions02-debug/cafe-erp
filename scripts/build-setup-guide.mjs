// Builds docs/cafe-setup-guide.html: the phone-friendly setup guide with the
// current database SQL baked in. Re-run after adding a migration:
//   node scripts/build-setup-guide.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase/migrations');

const setupSql = [
    '-- Cafe ERP: full database setup. Paste into Supabase -> SQL Editor -> New query -> Run (once per project).',
    ...readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
        .map(f => `\n-- ===== ${f} =====\n${readFileSync(join(migrationsDir, f), 'utf8')}`),
].join('\n');
const sampleSql = readFileSync(join(root, 'supabase/sample-data.sql'), 'utf8');

for (const [name, sql] of [['setup', setupSql], ['sample', sampleSql]]) {
    if (/<\/script/i.test(sql)) throw new Error(`${name} SQL contains "</script" and can't be embedded`);
}

const html = readFileSync(join(root, 'docs/setup-guide.template.html'), 'utf8')
    .replace('<!--SETUP_SQL-->', () => '\n' + setupSql)
    .replace('<!--SAMPLE_SQL-->', () => '\n' + sampleSql)
    .replace('BUILD_DATE', () => `built ${new Date().toISOString().slice(0, 10)}`);

writeFileSync(join(root, 'docs/cafe-setup-guide.html'), html);
console.log(`docs/cafe-setup-guide.html written (${Math.round(html.length / 1024)} KB)`);
