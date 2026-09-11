import { readFileSync } from 'fs';
import { join } from 'path';
import { readdirSync } from 'fs';

const ROOT = join(__dirname);
const moduleSource = readFileSync(join(ROOT, 'command.module.ts'), 'utf8');
const taskFiles = readdirSync(join(ROOT, 'tasks')).filter((f) =>
  f.endsWith('.ts')
);

const readTask = (file: string) =>
  readFileSync(join(ROOT, 'tasks', file), 'utf8');

// E2E-09-42: grandfather-subscriptions was a one-off backfill run before Stripe
// billing went live, and it stayed registered. One flag would write ULTIMATE,
// isLifetime and a hundred channels onto every organization with an empty or
// soft-deleted subscription — after launch, the whole free tier, permanently,
// with no product path back (E2E-09-41).

describe('command registry', () => {
  it('does not register the pre-launch grandfather backfill', () => {
    expect(moduleSource).not.toMatch(/^\s*GrandfatherSubscriptions,/m);
    expect(moduleSource).not.toMatch(
      /^import .*GrandfatherSubscriptions.*from/m
    );
  });

  it('registers the scrub that removes credentials from the errors table', () => {
    expect(moduleSource).toMatch(/^\s*ScrubErrorSecrets,/m);
  });
});

// E2E-09-44: `refresh` and `encrypt-tokens` wrote the moment they were called,
// while every other mutating command here defaults to a dry-run — so the
// muscle memory that these are safe to run and read was wrong exactly twice.
// `refresh` is the least read-only of all of them: it calls the providers,
// rewrites tokens, sets refreshNeeded and emails channel owners.
describe('every registered mutating command', () => {
  const registered = taskFiles.filter((f) => {
    const exported = readTask(f).match(/export class (\w+)/)?.[1];
    return exported && new RegExp(`^\\s*${exported},`, 'm').test(moduleSource);
  });

  const mutating = registered.filter((f) => f !== 'configuration.ts');

  it('finds the commands to check', () => {
    expect(mutating.length).toBeGreaterThanOrEqual(6);
  });

  it.each(mutating)('%s defaults to a dry-run and wants --apply', (file) => {
    const source = readTask(file);
    expect(source).toContain("process.argv.includes('--apply')");
    expect(source).toMatch(/DRY-RUN/);
  });
});
