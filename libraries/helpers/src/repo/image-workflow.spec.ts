import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..', '..');
const workflows = join(root, '.github', 'workflows');
const image = readFileSync(join(workflows, 'image.yml'), 'utf8');

// The image job holds a registry login that can push to the registry the
// deploys pull from. Nothing third-party runs there with the Docker socket:
// a moved tag of such a tool could push its own image (the Trivy release
// chain was hijacked in March 2026 and its scan was removed here for that).
describe('image workflow', () => {
  it('runs no container with the Docker socket', () => {
    for (const file of readdirSync(workflows)) {
      expect([file, readFileSync(join(workflows, file), 'utf8').includes('docker.sock')]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('runs no Trivy, as an action or an image', () => {
    for (const file of readdirSync(workflows)) {
      expect([file, /trivy/i.test(readFileSync(join(workflows, file), 'utf8'))]).toEqual([file, false]);
    }
  });

  it('asks only for what publishing needs', () => {
    const permissions = image.match(/^permissions:\n((?: {2}.+\n)+)/m)?.[1].trim().split('\n').map((l) => l.trim());
    expect(permissions).toEqual([
      'contents: read',
      'packages: write',
      'id-token: write',
      'attestations: write',
    ]);
  });
});
