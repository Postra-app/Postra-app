import { spawnSync } from 'child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// .github/scripts/asg-refresh.sh rolls the auto scaling group of the postra
// account onto the image in SSM (deploy-dev.yml, job deploy-asg). It must
// cancel a refresh that is still running (a superseded deploy), start one,
// and succeed only on Status=Successful - a Failed or Cancelled refresh, or
// one that never ends, must fail the deploy so the rollback runs. Run with a
// fake `aws` that plays a scripted sequence of statuses.

const root = join(__dirname, '..', '..', '..', '..');
const script = join(root, '.github', 'scripts', 'asg-refresh.sh');

// `active` answers the first describe (running refresh?), `statuses` the
// ones after start-instance-refresh, in order; the last one repeats.
const run = (active: string, statuses: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'asg-refresh-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  writeFileSync(join(dir, 'statuses'), statuses.join('\n') + '\n');
  writeFileSync(join(dir, 'calls'), '');
  writeFileSync(
    join(bin, 'aws'),
    `#!/usr/bin/env bash
echo "$*" >> "${join(dir, 'calls')}"
case "$*" in
  *start-instance-refresh*) echo "refresh-new" ;;
  *cancel-instance-refresh*) : ;;
  *"--instance-refresh-ids refresh-old"*) echo "Cancelled" ;;
  *"--instance-refresh-ids refresh-new"*)
    n=$(cat "${join(dir, 'n')}" 2>/dev/null || echo 0)
    total=$(wc -l < "${join(dir, 'statuses')}")
    [ "$n" -lt "$total" ] && n=$((n + 1))
    echo "$n" > "${join(dir, 'n')}"
    sed -n "\${n}p" "${join(dir, 'statuses')}" ;;
  *describe-instance-refreshes*) echo "${active}" ;;
esac
`
  );
  chmodSync(join(bin, 'aws'), 0o755);
  // sleep is a no-op so the waits take no time; the attempt count still runs.
  writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(bin, 'sleep'), 0o755);
  const result = spawnSync('bash', [script, 'postra-prod-app', '1'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  const calls = readFileSync(join(dir, 'calls'), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, out: result.stdout + result.stderr, calls };
};

describe('asg-refresh.sh', () => {
  it('starts a refresh and succeeds when it is Successful', () => {
    const { status, calls, out } = run('None', ['InProgress\t20\tNone', 'Successful\t100\tNone']);
    expect(status).toBe(0);
    expect(calls).toMatch(/start-instance-refresh --auto-scaling-group-name postra-prod-app/);
    expect(calls).toMatch(/"MinHealthyPercentage": 100, "MaxHealthyPercentage": 200/);
    expect(calls).not.toMatch(/cancel-instance-refresh/);
    expect(out).toMatch(/Successful/);
  });

  it('cancels a refresh that is still running before starting its own', () => {
    const { status, calls } = run('refresh-old', ['Successful\t100\tNone']);
    expect(status).toBe(0);
    const order = calls.split('\n');
    const cancel = order.findIndex((c) => /cancel-instance-refresh/.test(c));
    const start = order.findIndex((c) => /start-instance-refresh/.test(c));
    expect(cancel).toBeGreaterThan(-1);
    expect(cancel).toBeLessThan(start);
  });

  it.each(['Failed\t40\tInstances failed health checks', 'Cancelled\t0\tNone', 'RollbackSuccessful\t100\tNone'])(
    'fails the deploy when the refresh ends with %s',
    (last) => {
      const { status, out } = run('None', ['InProgress\t10\tNone', last]);
      expect(status).toBe(1);
      expect(out).toContain('ended with');
    }
  );

  it('fails the deploy when the refresh never finishes', () => {
    const { status, out } = run('None', ['InProgress\t50\tNone']);
    expect(status).toBe(1);
    expect(out).toMatch(/did not finish in 1 minutes/);
  });
});
