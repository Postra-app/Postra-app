import {
  REDACTED,
  hasSecrets,
  isSecretKey,
  redactSecrets,
  redactSecretsInJson,
} from '@gitroom/nestjs-libraries/services/redact.secrets';

// The shape that actually reaches Errors.body: the post list a workflow was
// holding when publishing failed, each post carrying its full Integration row.
const failedPostList = [
  {
    id: 'post-1',
    content: 'hello',
    state: 'ERROR',
    integration: {
      id: 'int-1',
      name: 'My IG',
      providerIdentifier: 'instagram',
      token: 'IGAAQ1234567890abcdef',
      refreshToken: 'IGAAQrefresh0987654321',
      customInstanceDetails: '{"url":"https://x","key":"k"}',
      profile: '17841400000000000',
      disabled: false,
    },
  },
];

describe('isSecretKey', () => {
  it('matches the same name across casing and separators', () => {
    expect(isSecretKey('refreshToken')).toBe(true);
    expect(isSecretKey('refresh_token')).toBe(true);
    expect(isSecretKey('REFRESH-TOKEN')).toBe(true);
    expect(isSecretKey('access_token')).toBe(true);
    expect(isSecretKey('customInstanceDetails')).toBe(true);
  });

  it('leaves names that only look adjacent alone', () => {
    expect(isSecretKey('tokenExpiration')).toBe(false);
    expect(isSecretKey('refreshNeeded')).toBe(false);
    expect(isSecretKey('providerIdentifier')).toBe(false);
  });
});

describe('redactSecrets', () => {
  it('strips credentials out of a failed post list and keeps the diagnosis', () => {
    const out = redactSecrets(failedPostList);
    const integration = out[0].integration;

    expect(integration.token).toBe(REDACTED);
    expect(integration.refreshToken).toBe(REDACTED);
    expect(integration.customInstanceDetails).toBe(REDACTED);

    // Everything support actually reads must survive untouched.
    expect(integration.providerIdentifier).toBe('instagram');
    expect(integration.name).toBe('My IG');
    expect(integration.disabled).toBe(false);
    expect(out[0].content).toBe('hello');
    expect(out[0].state).toBe('ERROR');
  });

  it('does not mutate the object it was given', () => {
    const input = JSON.parse(JSON.stringify(failedPostList));
    redactSecrets(input);
    expect(input[0].integration.token).toBe('IGAAQ1234567890abcdef');
  });

  it('reaches secrets nested at any depth', () => {
    const out = redactSecrets({
      response: { body: { data: { access_token: 'ya29.a0Af' } } },
    });
    expect(out.response.body.data.access_token).toBe(REDACTED);
  });

  it('redacts an encrypted token too — it is never needed to diagnose', () => {
    const out = redactSecrets({ token: 'enc::deadbeef' });
    expect(out.token).toBe(REDACTED);
  });

  it('leaves an empty or absent value as it found it', () => {
    const out = redactSecrets({ token: null, refreshToken: undefined });
    expect(out.token).toBeNull();
    expect(out.refreshToken).toBeUndefined();
  });

  it('passes non-plain objects through instead of rebuilding them', () => {
    const date = new Date('2026-09-11T00:00:00.000Z');
    const out = redactSecrets({ createdAt: date });
    expect(out.createdAt).toBe(date);
  });

  it('survives a circular reference', () => {
    const node: any = { token: 'secret' };
    node.self = node;
    expect(() => redactSecrets(node)).not.toThrow();
    expect(redactSecrets(node).token).toBe(REDACTED);
  });
});

describe('redactSecretsInJson', () => {
  it('round-trips a serialised body with the secrets gone', () => {
    const out = redactSecretsInJson(JSON.stringify(failedPostList));
    expect(out).not.toContain('IGAAQ1234567890abcdef');
    expect(out).not.toContain('IGAAQrefresh0987654321');
    expect(out).toContain('instagram');
  });

  it('leaves a plain error message alone', () => {
    const message = 'The user is not an admin of the page';
    expect(redactSecretsInJson(message)).toBe(message);
  });

  it('handles an empty body', () => {
    expect(redactSecretsInJson('')).toBe('');
    expect(redactSecretsInJson(null)).toBe('');
  });
});

describe('hasSecrets', () => {
  it('tells a dirty row from a clean one', () => {
    expect(hasSecrets(JSON.stringify(failedPostList))).toBe(true);
    expect(hasSecrets(redactSecretsInJson(JSON.stringify(failedPostList)))).toBe(
      false
    );
    expect(hasSecrets('plain message')).toBe(false);
    expect(hasSecrets(null)).toBe(false);
  });
});
