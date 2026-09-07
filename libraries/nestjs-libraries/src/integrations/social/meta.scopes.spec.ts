import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { ThreadsProvider } from './threads.provider';

// Pins what Meta connect REQUIRES to the set with Advanced Access on the
// Postra app (App Review approved 2026-07-15). Meta grants non-role users ONLY
// Advanced-access scopes, so one extra required entry silently breaks channel
// connect for every external user while still working for the team (app roles
// also get Standard access). An upstream Postiz sync is the usual way that
// extra entry sneaks back in. If this fails, either the scope gained Advanced
// Access in the Meta dashboard (then update the test deliberately) or the
// provider must not require it.
const requiredScopesOf = (provider: {
  scopes: string[];
  optionalScopes?: string[];
}) => provider.scopes.filter((s) => !provider.optionalScopes?.includes(s));

describe('Meta provider scopes', () => {
  it('facebook requires only Advanced-access scopes', () => {
    expect(requiredScopesOf(new FacebookProvider()).sort()).toEqual(
      [
        'business_management',
        'pages_manage_posts',
        'pages_read_engagement',
        'pages_show_list',
        'read_insights',
      ].sort()
    );
  });

  it('facebook asks for the first-comment scope without requiring it', () => {
    // pages_manage_engagement holds Advanced access since the mini App Review was
    // approved on 2026-09-07, so Meta grants it to everyone — and it still must
    // not move into the required list. Requiring a scope is what broke connect
    // for every external user in #188, and Meta can demote a permission back to
    // Standard without warning. This assertion is the guard against someone
    // "tidying up" the optional entry now that the permission is granted.
    const facebook = new FacebookProvider();

    expect(facebook.scopes).toContain('pages_manage_engagement');
    expect(facebook.optionalScopes).toContain('pages_manage_engagement');
    expect(facebook.commentScope).toBe('pages_manage_engagement');
  });

  it('instagram requires only Advanced-access scopes', () => {
    expect(requiredScopesOf(new InstagramProvider()).sort()).toEqual(
      [
        'business_management',
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_insights',
        'pages_read_engagement',
        'pages_show_list',
      ].sort()
    );
  });

  it('threads requests exactly the scopes staged for its app review', () => {
    // The separate "Postra Threads" Meta app is being submitted for review
    // with these four permissions. ThreadsProvider skips checkScopes, so a
    // mismatch surfaces as Meta rejecting the OAuth dialog (invalid scope) —
    // keep this list in lockstep with what the review approves.
    expect(new ThreadsProvider().scopes.sort()).toEqual(
      [
        'threads_basic',
        'threads_content_publish',
        'threads_manage_insights',
        'threads_manage_replies',
      ].sort()
    );
  });

  it('instagram asks for the first-comment scope without requiring it', () => {
    // instagram_manage_comments holds Advanced Access on the app (verified in
    // the dashboard 2026-07-26), so Meta grants it to every user. It is still
    // only asked for, never required: a scope that connect depends on is a
    // single point of failure the moment Meta changes its access level, which
    // is what took FB/IG connect down in #188.
    const instagram = new InstagramProvider();

    expect(instagram.scopes).toContain('instagram_manage_comments');
    expect(instagram.optionalScopes).toContain('instagram_manage_comments');
    expect(instagram.commentScope).toBe('instagram_manage_comments');
    expect(instagram.commentsDisabled).toBeUndefined();
  });
});
