import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// CI runs on one explicit Ubuntu image, the newest GitHub offers. Not
// "ubuntu-latest": that label moves on GitHub's schedule (24.04 → 26.04 from
// 2026-10-19), and Playwright 1.58 had no browsers for 26.04, so the deploy
// smoke would have broken on whatever day the runner flipped. Moving is a
// PR that CI checks; runner-freshness.yml opens an issue when a newer image
// exists.
//
// Playwright installs in CI take their version from the root devDependency.
// Copies written into workflows did not follow upgrades.

const root = join(__dirname, '..', '..', '..', '..');
const dir = join(root, '.github', 'workflows');
const workflows = readdirSync(dir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
const scripts = [
  ...workflows,
  ...['deploy-staging.sh', 'asg-refresh.sh'].map((name) => ({
    name: `scripts/${name}`,
    text: readFileSync(join(root, '.github', 'scripts', name), 'utf8'),
  })),
];

const labels = workflows.flatMap(({ name, text }) =>
  [...text.matchAll(/^\s*runs-on:\s*'?([^'\s]+)'?\s*$/gm)].map((m) => ({
    name,
    label: m[1],
  }))
);

describe('CI workflows', () => {
  it('run on one explicit Ubuntu image', () => {
    expect(labels.length).toBeGreaterThan(0);
    for (const { name, label } of labels) {
      expect(`${name}: ${label}`).toMatch(/: ubuntu-\d\d\.04$/);
    }
    expect(new Set(labels.map((l) => l.label)).size).toBe(1);
  });

  it.each(scripts)(
    '$name installs Playwright at the root devDependency version',
    ({ text }) => {
      expect(text).not.toMatch(/@playwright\/test@\d/);
    }
  );

  // Same for the Prisma CLI: `pnpm dlx prisma@6.5.0` in the scripts, the boot
  // migration and CI kept running 6.5 after @prisma/client moved to 6.19.
  it.each([
    ...scripts,
    {
      name: 'package.json scripts',
      text: JSON.stringify(
        JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
      ),
    },
    {
      name: 'scripts/db-migrate.mjs',
      text: readFileSync(join(root, 'scripts', 'db-migrate.mjs'), 'utf8'),
    },
  ])('$name runs the Prisma CLI from one version source', ({ text }) => {
    expect(text).not.toMatch(/prisma@\d/);
  });

  // Node and pnpm come from package.json (volta.node, packageManager).
  // Copies in workflows went stale: CI built on 22.12.0 while production ran
  // 22.20, and isomorphic-dompurify 3.23 needs 22.22.2.
  it.each(workflows)(
    '$name takes Node and pnpm from package.json',
    ({ text }) => {
      expect(text).not.toMatch(/node-version:\s*['"]?\d/);
      expect(text).not.toMatch(/node-version:\s*\$\{\{\s*matrix/);
      expect(text).not.toMatch(
        /action-setup@[^\n]*\n\s+with:\n(\s+[a-z_-]+:[^\n]*\n)*?\s+version:/
      );
    }
  );

  // Nothing scheduled publishes real posts. The nightly canary posted ads on
  // Telegram, Discord, Mastodon and Bluesky every day, and Mastodon suspended
  // the account for spam on 2026-10-12. Publishing runs are manual only.
  it.each(workflows)('$name publishes nothing on a schedule', ({ text }) => {
    if (!/^\s*schedule:/m.test(text)) return;
    expect(text).not.toMatch(/--project[= ]publish-/);
  });

  // The app lives on app.postra.co.uk since 2026-10-15. The deploy health
  // check and rollback still asked app-dev.postra.pl, which only answered
  // because the old name points at the same load balancer.
  it.each(scripts)('$name checks the app on app.postra.co.uk', ({ text }) => {
    expect(text).not.toMatch(/app(-dev)?\.postra\.pl/);
  });

  // The image installed pnpm@10.6.1 written into the Dockerfile and pm2 with
  // no version at all. Both come from var/docker/tools/package.json now,
  // which Dependabot watches, and pnpm there is the repo's packageManager.
  it('installs the image tools from one pinned manifest', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const tools = JSON.parse(
      readFileSync(join(root, 'var', 'docker', 'tools', 'package.json'), 'utf8')
    ).dependencies;
    const docker = readFileSync(join(root, 'Dockerfile.dev'), 'utf8');
    expect(`pnpm@${tools.pnpm}`).toBe(pkg.packageManager);
    for (const version of Object.values(tools)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(docker).toContain('var/docker/tools/package.json');
    expect(docker).not.toMatch(/install[^\n]*\b(pnpm|pm2)(@|\s|$)/);
    expect(docker).toMatch(/pnpm install --frozen-lockfile/);
  });

  // One workflow, two places to deploy to (Postra-infra runbook A5, W3): the
  // box on the shared account over SSM, and the auto scaling group of the
  // postra account by APP_IMAGE in SSM plus an instance refresh. Repository
  // variables choose; without them the box deploy runs as before, with its
  // parameters under /postra/dev.
  it('deploys to the box or to the group, chosen by repository variables', () => {
    const deploy = workflows.find((w) => w.name === 'deploy-dev.yml')!.text;
    expect(deploy).toContain("SSM_PREFIX: ${{ vars.SSM_PREFIX || '/postra/dev' }}");
    expect(deploy).not.toMatch(/get-parameters-by-path --path \/postra\/dev\//);
    expect(deploy).toMatch(/--arg prefix "\$\{SSM_PREFIX\}"/);
    expect(deploy).toMatch(/^  deploy:\n[\s\S]*?if: always\(\) && vars\.DEPLOY_TARGET != 'asg'/m);
    expect(deploy).toMatch(/^  deploy-asg:\n[\s\S]*?if: always\(\) && vars\.DEPLOY_TARGET == 'asg'/m);
    expect(deploy).toMatch(/put-parameter --name "\$\{SSM_PREFIX\}\/APP_IMAGE"/);
    expect(deploy).toContain('.github/scripts/asg-refresh.sh "${ASG_NAME}"');
    // The same commit again skips the build: the tag is immutable.
    expect(deploy).toMatch(/ecr describe-images --repository-name "\$\{ECR_REPOSITORY\}" --image-ids "imageTag=\$\{IMAGE_TAG_SHA\}"/);
    expect(deploy.match(/if: steps\.existing\.outputs\.exists != 'true'/g)).toHaveLength(2);
  });

  // pm2 kept every process's output in /www/.pm2/logs for ever and nginx
  // wrote access.log into the container, read by nobody and reset only by a
  // deploy (E2E-11-35). pm2-logrotate comes from the same pinned manifest as
  // pm2 (Dependabot watches it), is installed as the user pm2 runs as, and
  // nginx logs to the container's output, which Docker rotates.
  it('rotates the logs inside the image', () => {
    const tools = JSON.parse(
      readFileSync(join(root, 'var', 'docker', 'tools', 'package.json'), 'utf8')
    ).dependencies;
    const docker = readFileSync(join(root, 'Dockerfile.dev'), 'utf8');
    const nginx = readFileSync(
      join(root, 'var', 'docker', 'nginx.conf'),
      'utf8'
    );
    expect(tools['pm2-logrotate']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(docker).toMatch(
      /pm2 install "pm2-logrotate@\$\(node -p "require\('\/tmp\/tools\/package\.json'\)\.dependencies\['pm2-logrotate'\]"\)"/
    );
    expect(docker).toMatch(/pm2 set pm2-logrotate:max_size \d+M/);
    expect(docker).toMatch(/pm2 set pm2-logrotate:retain \d+/);
    expect(docker.indexOf('USER www')).toBeGreaterThan(0);
    expect(docker.indexOf('USER www')).toBeLessThan(
      docker.indexOf('pm2 install')
    );
    // The global install must leave the module to pm2.
    expect(docker).toMatch(/filter\(\(\[n\]\) => n !== 'pm2-logrotate'\)/);
    expect(nginx).toMatch(/^\s*access_log\s+\/dev\/stdout;/m);
    expect(nginx).toMatch(/^\s*error_log\s+\/dev\/stderr/m);
    expect(nginx).not.toMatch(/\/var\/log\/nginx\/access\.log/);
  });

  // pnpm 10.34 runs no build scripts in `pnpm dlx` unless allowed: Prisma
  // then downloaded its engines in the middle of `migrate diff`, and one
  // dropped connection failed the job (19 X).
  it('lets dlx prisma install its engines', () => {
    const dlx = workflows
      .flatMap(({ text }) => text.split('\n'))
      .filter((line) => /pnpm dlx\b.*\bprisma@/.test(line));
    expect(dlx.length).toBeGreaterThan(0);
    for (const line of dlx) {
      expect(line).toContain('--allow-build=@prisma/engines');
    }
  });

  it('builds the production image on the Node in volta.node', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const docker = readFileSync(join(root, 'Dockerfile.dev'), 'utf8');
    const image = docker.match(/^FROM node:(\S+)/m)?.[1] ?? '';
    expect(image.startsWith(`${pkg.volta.node}-`)).toBe(true);
  });
});
