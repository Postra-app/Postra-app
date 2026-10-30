// Keeps the newest KEEP images of the container package that image.yml
// publishes (one sha-<commit> image per commit on main) and deletes the older
// ones. A pushed image can bring untagged versions with it (the provenance
// attestation, platform manifests of an index). They are deleted only when
// created well before the oldest kept image: the children of a kept image
// are pushed by the same job, within its timeout, so they are never older
// than that.
//
//   node scripts/prune-image-versions.mjs              delete (GITHUB_TOKEN)
//   node scripts/prune-image-versions.mjs --plan FILE  print the ids it would
//                                                      delete from a saved
//                                                      versions list
import { readFileSync } from 'node:fs';

const KEEP = Number(process.env.KEEP || 20);
// Longer than the image job's timeout (60 min).
const CHILD_WINDOW_MS = 2 * 60 * 60 * 1000;

const isImage = (v) =>
  (v.metadata?.container?.tags || []).some((t) => t.startsWith('sha-'));
const time = (v) => Date.parse(v.created_at);

export function versionsToDelete(versions, keep = KEEP) {
  const images = versions.filter(isImage).sort((a, b) => time(b) - time(a));
  if (images.length <= keep) return [];
  const cutoff = time(images[keep - 1]) - CHILD_WINDOW_MS;
  const old = images.slice(keep);
  const orphans = versions.filter(
    (v) => !(v.metadata?.container?.tags || []).length && time(v) < cutoff
  );
  return [...old, ...orphans].map((v) => v.id);
}

async function main() {
  const planIndex = process.argv.indexOf('--plan');
  if (planIndex > 0) {
    const versions = JSON.parse(readFileSync(process.argv[planIndex + 1], 'utf8'));
    console.log(JSON.stringify(versionsToDelete(versions)));
    return;
  }

  const owner = process.env.PACKAGE_OWNER;
  const name = process.env.PACKAGE_NAME;
  const base = `https://api.github.com/orgs/${owner}/packages/container/${name}/versions`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const versions = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${base}?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`list versions: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    versions.push(...batch);
    if (batch.length < 100) break;
  }

  const ids = versionsToDelete(versions);
  console.log(
    `${versions.length} versions, ${versions.filter(isImage).length} images; deleting ${ids.length}, keeping the newest ${KEEP} images`
  );
  for (const id of ids) {
    const res = await fetch(`${base}/${id}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`delete ${id}: ${res.status} ${await res.text()}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
