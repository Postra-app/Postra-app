import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The Sentry token used to reach the image build as a build argument, and
// Dockerfile.dev turned it into an ENV: every production image carried it in
// its config and in its layer history. A credential goes in as a BuildKit
// secret (`RUN --mount=type=secret`), which leaves nothing in the image.

const root = join(__dirname, '..', '..', '..', '..');
const sensitive = /(TOKEN|SECRET|PASSWORD|PASS|PRIVATE|API_KEY|AUTH)/;

describe('docker build secrets', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile.dev'), 'utf8');

  it('declares no credential as ARG or ENV in Dockerfile.dev', () => {
    const names = [...dockerfile.matchAll(/^\s*(?:ARG|ENV)\s+([A-Z0-9_]+)/gm)].map(
      (m) => m[1]
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => sensitive.test(name))).toEqual([]);
  });

  it('mounts the Sentry token as a secret on the build step', () => {
    expect(dockerfile).toMatch(
      /RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN[\s\\]+NODE_OPTIONS=\S+ pnpm run build/
    );
  });

  it('passes no credential to docker build as a build argument', () => {
    const dir = join(root, '.github', 'workflows');
    const args = readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        [
          ...readFileSync(join(dir, name), 'utf8').matchAll(
            /--build-arg\s+([A-Z0-9_]+)=/g
          ),
        ].map((m) => `${name}: ${m[1]}`)
      );
    expect(args.length).toBeGreaterThan(0);
    expect(args.filter((arg) => sensitive.test(arg.split(': ')[1]))).toEqual(
      []
    );
  });
});
