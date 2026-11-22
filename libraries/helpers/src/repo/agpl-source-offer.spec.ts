import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// AGPL-3.0 section 13 offers the source to everyone who uses the program
// over the network. The offer was only in Settings, which a person on the
// sign-in screen or a client opening a shared preview never sees.
describe('the offer of the source code', () => {
  const offer = 'href={sourceCodeUrl(process.env.NEXT_PUBLIC_VERSION)}';

  it.each([
    ['Settings', 'apps/frontend/src/components/settings/global.settings.tsx'],
    ['the sign-in screens', 'apps/frontend/src/app/(app)/auth/layout.tsx'],
    ['the shared preview', 'apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx'],
  ])('is on %s and points at the running version', (_, path) => {
    expect(read(path)).toContain(offer);
  });
});

// Section 4: every copy that is handed out carries the licence. The npm
// package @postra/node 1.3.0 said "AGPL-3.0" in its manifest and shipped
// without the text.
describe('the licence travels with what is published', () => {
  it('every package in apps/ declares AGPL-3.0', () => {
    for (const app of readdirSync(join(root, 'apps'))) {
      let manifest: { license?: string };
      try {
        manifest = JSON.parse(read(`apps/${app}/package.json`));
      } catch {
        continue;
      }
      expect([app, manifest.license]).toEqual([app, 'AGPL-3.0']);
    }
  });

  it('the SDK package carries the same licence text as the repository', () => {
    expect(read('apps/sdk/LICENSE')).toBe(read('LICENSE'));
    const [packed] = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: join(root, 'apps/sdk'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    );
    expect(packed.files.map((file: { path: string }) => file.path)).toContain(
      'LICENSE'
    );
  });
});
