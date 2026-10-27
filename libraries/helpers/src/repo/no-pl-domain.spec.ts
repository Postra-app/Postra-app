import { execFileSync } from 'child_process';
import { join } from 'path';

// The launch is in the UK (2026-10-27): what a customer sees, follows or is
// sent points at postra.co.uk, not postra.pl. The help page linked the status
// page on status.postra.pl, the webhook test sent a postra.pl picture that
// answered 404, and the agency e-mails linked postra.pl. A postra.pl name is
// allowed only where it is the real host of something that has not moved.

const root = join(__dirname, '..', '..', '..', '..');

const allowed: { file: string; why: string }[] = [
  // Media stored before 2026-10-27 keep their cdn-dev.postra.pl URLs.
  { file: 'libraries/helpers/src/utils/valid.url.path.ts', why: 'CDN host' },
  // TikTok's redirect stays on app.postra.pl: a change there is a new review.
  { file: 'libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts', why: 'TikTok redirect' },
  // The Polish text of a template, shown only with the Polish interface.
  { file: 'apps/frontend/src/components/design-editor/templates/built-in-templates.ts', why: 'Polish locale' },
  // Staging is internal and still lives on staging.postra.pl.
  { file: '.github/scripts/deploy-staging.sh', why: 'staging' },
  { file: '.github/workflows/deploy.yml', why: 'staging' },
  // The repository README lists the Polish site beside the UK one.
  { file: 'README.md', why: 'Polish site' },
];

const tracked = execFileSync('git', ['grep', '-l', '-i', '-I', 'postra\\.pl', '--', '.'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => !/(\.spec\.|\.test\.|__tests__\/|pnpm-lock\.yaml$)/.test(f));

describe('postra.pl in the app', () => {
  it('appears only where it is still the real host', () => {
    const allowedFiles = allowed.map((a) => a.file);
    expect(tracked.filter((f) => !allowedFiles.includes(f))).toEqual([]);
  });
});
