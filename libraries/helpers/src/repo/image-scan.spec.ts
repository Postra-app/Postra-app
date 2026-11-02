import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..', '..');
const image = readFileSync(join(root, '.github', 'workflows', 'image.yml'), 'utf8');

// §60 C8: every published image is scanned for known vulnerabilities and the
// result lands in the Security tab; a new CVE never blocks a deploy.
describe('image scan', () => {
  it('scans the image it just pushed, pinned to a commit', () => {
    expect(image).toMatch(/uses: aquasecurity\/trivy-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    expect(image).toContain('image-ref: ${{ env.IMAGE }}:sha-${{ github.sha }}');
  });

  it('reports without failing the build', () => {
    expect(image).toMatch(/exit-code: '0'/);
    expect(image).toMatch(/uses: github\/codeql-action\/upload-sarif@v\d+/);
    expect(image).toMatch(/security-events: write/);
  });

  it('runs after the image is published, so a scan problem cannot stop it', () => {
    expect(image.indexOf('name: Scan the image')).toBeGreaterThan(image.indexOf('name: Push Docker image'));
  });
});
