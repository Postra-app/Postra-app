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

  // One 404 from the transparency log failed the job after the image was
  // pushed: nothing could be deployed until the build was re-run by hand.
  describe('the attestation', () => {
    const steps = image
      .slice(image.indexOf('  image:'), image.indexOf('  prune:'))
      .split(/\n(?= {6}- name: )/)
      .filter((step) => step.includes('actions/attest-build-provenance@'));

    it('is tried three times, with the same pinned action and the same subject', () => {
      expect(steps).toHaveLength(3);
      const uses = steps.map((step) => step.match(/uses: (\S+)/)?.[1]);
      expect(new Set(uses).size).toBe(1);
      expect(uses[0]).toMatch(/@[0-9a-f]{40}$/);
      for (const step of steps) {
        expect(step).toContain('subject-digest: ${{ steps.push.outputs.digest }}');
        expect(step).toContain('push-to-registry: true');
      }
    });

    it('a later attempt runs only when the one before it failed', () => {
      expect(steps[0]).not.toMatch(/\n {8}if:/);
      expect(steps[1]).toContain("if: steps.attest1.outcome == 'failure'");
      expect(steps[2]).toContain("if: steps.attest2.outcome == 'failure'");
    });

    it('only the last attempt can fail the job, and it can', () => {
      expect(steps[0]).toContain('continue-on-error: true');
      expect(steps[1]).toContain('continue-on-error: true');
      // an image nobody signed must not look published
      expect(steps[2]).not.toContain('continue-on-error');
    });

    it('waits between attempts', () => {
      expect(image).toMatch(/if: steps\.attest1\.outcome == 'failure'\n {8}run: sleep 60/);
      expect(image).toMatch(/if: steps\.attest2\.outcome == 'failure'\n {8}run: sleep 120/);
    });
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
