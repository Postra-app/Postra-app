import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// This repository is public because the AGPL requires the source of the
// running program, and it holds that and nothing more: the program's code,
// its tests and its CI. Instructions for AI agents, operator notes, plans,
// tracker IDs and infrastructure details live elsewhere.

const root = join(__dirname, '..', '..', '..', '..');
const tracked = execSync('git ls-files -z', { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

// Migrations applied before the rule was written keep their comments: an
// applied migration cannot change (Prisma checks its checksum).
const MIGRATIONS = 'libraries/nestjs-libraries/src/database/prisma/migrations/';
const RULE_SINCE = '20261103';
const exempt = (file: string) =>
  file === 'pnpm-lock.yaml' ||
  file === 'libraries/helpers/src/repo/public-repo-minimum.spec.ts' ||
  (file.startsWith(MIGRATIONS) && file.slice(MIGRATIONS.length, MIGRATIONS.length + 8) < RULE_SINCE);

// Shapes only. The names of what is private (repositories, people,
// accounts) cannot be listed in a public file without publishing them, so
// those are checked against this repository from outside it.
const FORBIDDEN: Array<[string, RegExp]> = [
  ['a tracker ID', new RegExp('E2E' + '-\\d{2}-\\d+')],
  ['a path into the plans', new RegExp('\\b' + 'Plan' + '/[A-Za-z]')],
  ['an ARN with an account ID', new RegExp('arn:aws:[a-z0-9-]+:[a-z0-9-]*:\\d{12}:')],
];

describe('the public repository', () => {
  it('has no files for AI agents or review tools', () => {
    const agentFiles = tracked.filter((file) =>
      /(^|\/)(AGENTS|CLAUDE)\.md$|^\.claude\/|(^|\/)copilot-instructions\.md$|(^|\/)\.coderabbit\.ya?ml$/.test(file)
    );
    expect(agentFiles).toEqual([]);
  });

  it('points at no plans or tracker IDs and carries no ARNs', () => {
    const hits: string[] = [];
    for (const file of tracked) {
      if (exempt(file)) continue;
      let text: string;
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        continue; // a symlink or a file removed in the working tree
      }
      if (text.includes('\0')) continue; // binary
      for (const [what, pattern] of FORBIDDEN) {
        const match = text.match(pattern);
        if (match) hits.push(`${file}: ${what} (${match[0]})`);
      }
    }
    expect(hits).toEqual([]);
  });
});
