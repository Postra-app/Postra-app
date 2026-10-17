import { pgConnectionString } from './pg-connection';

describe('pgConnectionString', () => {
  it('asks pg for full verification where the URL says require', () => {
    expect(
      pgConnectionString(
        'postgresql://u:p@db.eu-west-2.rds.amazonaws.com:5432/postra?schema=public&sslmode=require'
      )
    ).toBe(
      'postgresql://u:p@db.eu-west-2.rds.amazonaws.com:5432/postra?schema=public&sslmode=verify-full'
    );
    expect(pgConnectionString('postgresql://u:p@h/db?sslmode=require')).toBe(
      'postgresql://u:p@h/db?sslmode=verify-full'
    );
  });

  it('leaves URLs without sslmode=require alone', () => {
    for (const url of [
      'postgresql://postra:postra@localhost:5432/postra',
      'postgresql://u:p@h/db?sslmode=disable',
      'postgresql://u:p@h/db?sslmode=requirex',
    ]) {
      expect(pgConnectionString(url)).toBe(url);
    }
  });
});
