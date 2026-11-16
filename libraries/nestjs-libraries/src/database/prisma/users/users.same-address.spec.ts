import { UsersRepository } from './users.repository';

// The case-insensitive lookup is a pattern match in the database: "_" and
// "%" in what was typed stand for any character.
describe('finding an account by the address typed', () => {
  const victim = { id: 'u1', email: 'Victim@x.com' };
  const repo = (found: unknown) => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // the exact match
      .mockResolvedValueOnce(found); // what the pattern match returned
    const r = Object.create(UsersRepository.prototype);
    Object.assign(r, { _user: { model: { user: { findFirst } } } });
    return r as UsersRepository;
  };

  it('the same address in another case is the account', async () => {
    await expect(repo(victim).getUserByEmail('victim@x.com')).resolves.toBe(victim);
  });

  it.each(['v_ctim@x.com', '%@x.com', '%ictim@x.com', '______@x.com'])(
    '%s is not victim@x.com',
    async (typed) => {
      await expect(repo(victim).getUserByEmail(typed)).resolves.toBeNull();
    }
  );

  it('nobody found is nobody', async () => {
    await expect(repo(null).getUserByEmail('a@x.com')).resolves.toBeNull();
  });
});
