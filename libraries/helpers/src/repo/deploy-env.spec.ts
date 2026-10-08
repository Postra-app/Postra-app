import { spawnSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Every deploy rebuilds /opt/postra/.env from SSM on the box. The file holds
// decrypted secrets, so it must be root-only (E2E-11-10: production had 0644),
// and a failed or partial SSM read must not replace a working .env. This runs
// the exact commands the deploys send through SSM, with a fake `aws`.

const root = join(__dirname, '..', '..', '..', '..');

const sources = [
  {
    name: 'deploy-dev.yml',
    prefix: '/postra/dev/',
    text: readFileSync(
      join(root, '.github', 'workflows', 'deploy-dev.yml'),
      'utf8'
    ),
  },
  {
    name: 'scripts/deploy-staging.sh',
    prefix: '/postra/staging/',
    text: readFileSync(
      join(root, '.github', 'scripts', 'deploy-staging.sh'),
      'utf8'
    ),
  },
];

// The jq program is JSON apart from the bare `commands:` key and the
// \(...) interpolations.
const ssmCommands = (text: string): string[] => {
  const program = text.match(/jq -nc [^']*'(\{\s*commands:[\s\S]*?\])\s*\}'\)/);
  if (!program) throw new Error('jq program for the SSM commands not found');
  const json = `${program[1].replace(/commands:/, '"commands":')}}`
    .replace(/\\\(\$region\)/g, 'eu-west-2')
    .replace(/\\\(\$registry\)/g, 'registry.example')
    .replace(/\\\(\$image\)/g, 'image:tag');
  return JSON.parse(json).commands;
};

// From the SSM read (with the umask before it, if any) to the move into .env
// (with the umask after it, if any).
const envCommands = (commands: string[]): string[] => {
  let from = commands.findIndex((c) => c.includes('get-parameters-by-path'));
  let to = commands.findIndex((c) => c.includes('mv .env.new .env'));
  if (from < 0 || to < 0) throw new Error('.env commands not found');
  if (/^umask /.test(commands[from - 1])) from -= 1;
  if (/^umask /.test(commands[to + 1] ?? '')) to += 1;
  return commands.slice(from, to + 1);
};

const run = (
  commands: string[],
  ssmOutput: string,
  ssmExit: number
): { status: number | null; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-env-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  writeFileSync(join(dir, 'ssm.out'), ssmOutput);
  writeFileSync(
    join(bin, 'aws'),
    `#!/usr/bin/env bash\ncat "${join(dir, 'ssm.out')}"\nexit ${ssmExit}\n`
  );
  chmodSync(join(bin, 'aws'), 0o755);
  writeFileSync(join(dir, '.env'), 'OLD=1\n');
  chmodSync(join(dir, '.env'), 0o600);
  const script = ['umask 022', 'set -e', ...commands].join('\n');
  const result = spawnSync('bash', ['-c', script], {
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  return { status: result.status, dir };
};

describe.each(sources)('$name writes .env', ({ text, prefix }) => {
  const commands = envCommands(ssmCommands(text));
  const full = `${prefix}DATABASE_URL\tpostgres://db\n${prefix}JWT_SECRET\tsecret\n${prefix}SMTP_PASS\tp w\n`;
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('readable by root only, with every parameter and no leftovers', () => {
    const { status, dir } = run(commands, full, 0);
    dirs.push(dir);
    expect(status).toBe(0);
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(
      'DATABASE_URL=postgres://db\nJWT_SECRET=secret\nSMTP_PASS=p w\n'
    );
    expect(existsSync(join(dir, '.env.new'))).toBe(false);
    expect(existsSync(join(dir, '.env.ssm'))).toBe(false);
  });

  it('keeps the current .env when the SSM read fails part-way', () => {
    const { status, dir } = run(
      commands,
      `${prefix}DATABASE_URL\tpostgres://db\n`,
      255
    );
    dirs.push(dir);
    expect(status).not.toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('OLD=1\n');
  });

  it('keeps the current .env when a key the app needs is missing', () => {
    const { status, dir } = run(
      commands,
      `${prefix}DATABASE_URL\tpostgres://db\n${prefix}SMTP_PASS\tx\n`,
      0
    );
    dirs.push(dir);
    expect(status).not.toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('OLD=1\n');
  });
});
