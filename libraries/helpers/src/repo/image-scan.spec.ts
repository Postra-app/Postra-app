import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..', '..');
const image = readFileSync(join(root, '.github', 'workflows', 'image.yml'), 'utf8');
const tool = readFileSync(join(root, '.github', 'tools', 'trivy.Dockerfile'), 'utf8');
const dependabot = readFileSync(join(root, '.github', 'dependabot.yml'), 'utf8');

// Every published image is scanned for known vulnerabilities and the
// result lands in the Security tab; a new CVE never blocks a deploy.
describe('image scan', () => {
  it('scans the image it just pushed, with the Trivy version from one file Dependabot watches', () => {
    expect(image).toContain("TRIVY=$(sed -n 's/^FROM //p' .github/tools/trivy.Dockerfile)");
    expect(image).toContain('"${IMAGE}:sha-${GITHUB_SHA}"');
    expect(tool).toMatch(/^FROM aquasec\/trivy:\d+\.\d+\.\d+$/m);
    expect(dependabot).toMatch(/package-ecosystem: "docker"\s+directory: "\/\.github\/tools"/);
  });

  it('uses no third-party action (the repository allows GitHub-owned and pnpm only)', () => {
    const actions = [...image.matchAll(/uses: ([^@\s]+)@/g)].map((m) => m[1]);
    expect(actions.every((a) => a.startsWith('actions/') || a.startsWith('github/'))).toBe(true);
  });

  it('reports without failing the build', () => {
    expect(image).toMatch(/--exit-code 0/);
    // A scanner outage (its database download) neither reddens the run nor
    // skips the prune job that needs it.
    expect(image).toMatch(/name: Scan the image\n\s+continue-on-error: true/);
    expect(image).toMatch(/name: Upload the image scan\n\s+continue-on-error: true/);
    expect(image).toMatch(/uses: github\/codeql-action\/upload-sarif@v\d+/);
    expect(image).toMatch(/security-events: write/);
  });

  it('runs after the image is published, so a scan problem cannot stop it', () => {
    expect(image.indexOf('name: Scan the image')).toBeGreaterThan(image.indexOf('name: Push Docker image'));
  });
});
