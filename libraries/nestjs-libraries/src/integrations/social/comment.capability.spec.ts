import {
  canPostComments,
  commentSupport,
  grantedScopesOf,
} from './comment.capability';

// The composer and the publish workflow both answer "can this channel take a
// first comment?" through this helper. When they disagreed, users wrote
// comments that were silently dropped at publish (#195) — so the rules live in
// one place and are pinned here.
const integration = (grantedScopes?: string | null) =>
  ({ grantedScopes } as any);

const provider = (over: Record<string, any> = {}) =>
  ({ comment: () => Promise.resolve([]), ...over } as any);

describe('grantedScopesOf', () => {
  it('reads the recorded scopes', () => {
    expect(grantedScopesOf(integration('["a","b"]'))).toEqual(['a', 'b']);
  });

  it('is empty when nothing was recorded or the value is unusable', () => {
    expect(grantedScopesOf(integration(null))).toEqual([]);
    expect(grantedScopesOf(integration(''))).toEqual([]);
    expect(grantedScopesOf(integration('not json'))).toEqual([]);
    // A non-array JSON value must not leak through as scopes.
    expect(grantedScopesOf(integration('{"a":1}'))).toEqual([]);
  });
});

describe('canPostComments', () => {
  it('says no when the provider has no comment support at all', () => {
    expect(canPostComments(provider({ comment: undefined }), integration())).toBe(
      false
    );
  });

  it('says no when the platform retired the permission (commentsDisabled)', () => {
    expect(
      canPostComments(provider({ commentsDisabled: true }), integration('["x"]'))
    ).toBe(false);
  });

  it('says yes when the provider needs no particular scope', () => {
    expect(canPostComments(provider(), integration())).toBe(true);
  });

  describe('when the provider gates comments on a scope', () => {
    const facebookLike = provider({ commentScope: 'pages_manage_engagement' });

    it('allows a channel whose token was granted it', () => {
      expect(
        canPostComments(
          facebookLike,
          integration('["pages_manage_posts","pages_manage_engagement"]')
        )
      ).toBe(true);
    });

    it('refuses a channel that was not granted it', () => {
      expect(
        canPostComments(facebookLike, integration('["pages_manage_posts"]'))
      ).toBe(false);
    });

    it('refuses a channel connected before we recorded scopes', () => {
      // null is "unknown", and unknown must fail closed: offering the feature
      // and dropping the comment at publish is the failure we are fixing.
      expect(canPostComments(facebookLike, integration(null))).toBe(false);
    });
  });
});

// The reason decides what the user is told when a comment can't go out: a
// platform with no comment API at all (TikTok) is not a missing permission.
describe('commentSupport', () => {
  it('no_api when the provider cannot post comments at all', () => {
    expect(commentSupport(provider({ comment: undefined }), integration())).toBe(
      'no_api'
    );
    expect(commentSupport(null, integration())).toBe('no_api');
  });

  it('not_granted when comments are switched off or the scope is missing', () => {
    expect(
      commentSupport(provider({ commentsDisabled: true }), integration('["x"]'))
    ).toBe('not_granted');
    expect(
      commentSupport(
        provider({ commentScope: 'pages_manage_engagement' }),
        integration('["pages_manage_posts"]')
      )
    ).toBe('not_granted');
  });

  it('yes when the provider can comment and has what it needs', () => {
    expect(commentSupport(provider(), integration())).toBe('yes');
    expect(
      commentSupport(
        provider({ commentScope: 'pages_manage_engagement' }),
        integration('["pages_manage_engagement"]')
      )
    ).toBe('yes');
  });
});
