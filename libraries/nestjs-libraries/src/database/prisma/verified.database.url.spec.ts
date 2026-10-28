import fs from 'fs';
import os from 'os';
import path from 'path';
import { verifiedDatabaseUrl } from './prisma.service';

describe('verifiedDatabaseUrl', () => {
  const base = 'postgresql://u:p@db:5432/postra?schema=public&sslmode=require';
  const ca = path.join(os.tmpdir(), 'verified-db-url-ca.pem');
  beforeAll(() => fs.writeFileSync(ca, 'cert'));
  afterAll(() => fs.rmSync(ca, { force: true }));
  afterEach(() => delete process.env.DATABASE_CA_FILE);

  it('leaves the URL alone without DATABASE_CA_FILE', () => {
    expect(verifiedDatabaseUrl(base)).toBe(base);
    expect(verifiedDatabaseUrl(undefined)).toBeUndefined();
  });

  it('asks Prisma to verify the server against the named root CA', () => {
    process.env.DATABASE_CA_FILE = ca;
    expect(verifiedDatabaseUrl(base)).toBe(
      `${base}&sslaccept=strict&sslcert=${ca}`
    );
    expect(verifiedDatabaseUrl('postgresql://db/postra')).toBe(
      `postgresql://db/postra?sslaccept=strict&sslcert=${ca}`
    );
  });

  it('keeps an sslaccept the URL already sets', () => {
    process.env.DATABASE_CA_FILE = ca;
    const own = `${base}&sslaccept=accept_invalid_certs`;
    expect(verifiedDatabaseUrl(own)).toBe(own);
  });

  it('stops the start when the CA file is missing, instead of connecting unverified', () => {
    process.env.DATABASE_CA_FILE = '/nowhere/ca.pem';
    expect(() => verifiedDatabaseUrl(base)).toThrow(/does not exist/);
  });
});
