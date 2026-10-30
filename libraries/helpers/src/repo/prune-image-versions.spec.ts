import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// scripts/prune-image-versions.mjs (job "prune" in image.yml) deletes old
// images of the container package. An image pushed with its attestation
// leaves untagged versions next to it; deleting those of a kept image would
// break it, so the test pins which versions go.

const root = join(__dirname, '..', '..', '..', '..');
const script = join(root, 'scripts', 'prune-image-versions.mjs');

const hour = 60 * 60 * 1000;
const start = Date.parse('2026-10-01T00:00:00Z');
const at = (h: number) => new Date(start + h * hour).toISOString();

// One image every 3 hours; each push brings an untagged child a minute
// before it and an untagged attestation a minute after.
function history(images: number) {
  const versions: object[] = [];
  for (let i = 0; i < images; i++) {
    const t = i * 3;
    versions.push({ id: i * 10 + 1, created_at: at(t - 1 / 60), metadata: { container: { tags: [] } } });
    versions.push({ id: i * 10 + 2, created_at: at(t), metadata: { container: { tags: [`sha-${i}`] } } });
    versions.push({ id: i * 10 + 3, created_at: at(t + 1 / 60), metadata: { container: { tags: [] } } });
  }
  return versions;
}

function plan(versions: object[], keep: number) {
  const dir = mkdtempSync(join(tmpdir(), 'prune-'));
  const file = join(dir, 'versions.json');
  writeFileSync(file, JSON.stringify(versions));
  const out = execFileSync('node', [script, '--plan', file], {
    env: { ...process.env, KEEP: String(keep) },
    encoding: 'utf8',
  });
  return (JSON.parse(out) as number[]).sort((a, b) => a - b);
}

describe('prune-image-versions', () => {
  it('deletes nothing while there are no more images than it keeps', () => {
    expect(plan(history(3), 3)).toEqual([]);
  });

  it('deletes the older images with their untagged versions, never those of a kept image', () => {
    // 5 images, keep 2: images 3 and 4 stay with their children.
    expect(plan(history(5), 2)).toEqual([1, 2, 3, 11, 12, 13, 21, 22, 23]);
  });

  it('keeps untagged versions pushed close before the oldest kept image', () => {
    const versions = history(3);
    // An untagged version 30 minutes before image 1 (the oldest kept with
    // keep 2) may belong to it.
    versions.push({ id: 99, created_at: at(3 - 0.5), metadata: { container: { tags: [] } } });
    expect(plan(versions, 2)).toEqual([1, 2, 3]);
  });
});
