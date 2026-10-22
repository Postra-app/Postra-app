// Copies the language switcher's flags from the flag-icons package into
// apps/frontend/public/flags. Run it after a flag-icons bump; flags.spec.ts
// fails until the copies match the package again. The codes are what
// getCountryCodeForFlag (flag.code.ts) returns for i18n.config's languages.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const codes = ['gb', 'pl', 'il', 'ru', 'cn', 'fr', 'es', 'pt', 'de', 'it', 'jp', 'kr', 'sa', 'tr', 'vn'];
const target = join(root, 'apps', 'frontend', 'public', 'flags');
mkdirSync(target, { recursive: true });
for (const code of codes) {
  copyFileSync(
    join(root, 'node_modules', 'flag-icons', 'flags', '4x3', `${code}.svg`),
    join(target, `${code}.svg`)
  );
}
console.log(`${codes.length} flags copied to apps/frontend/public/flags`);
