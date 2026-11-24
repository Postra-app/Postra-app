import {
  commentStepReason,
  waitsForCommentStep,
} from '@gitroom/frontend/components/new-launch/comment-step';

describe('waitsForCommentStep', () => {
  it('is a TikTok channel without first comment turned on', () => {
    expect(waitsForCommentStep({ identifier: 'tiktok', canComment: false })).toBe(true);
  });

  it('is not a TikTok channel with first comment on, or an older payload', () => {
    expect(waitsForCommentStep({ identifier: 'tiktok', canComment: true })).toBe(false);
    expect(waitsForCommentStep({ identifier: 'tiktok' })).toBe(false);
  });

  it('is a YouTube channel connected without the comment scope', () => {
    expect(waitsForCommentStep({ identifier: 'youtube', canComment: false })).toBe(true);
    expect(waitsForCommentStep({ identifier: 'youtube', canComment: true })).toBe(false);
  });

  it('is not a Facebook Page without the permission: its comment is sent and the failure reported', () => {
    expect(waitsForCommentStep({ identifier: 'facebook', canComment: false })).toBe(false);
  });
});

describe('commentStepReason', () => {
  it('asks the owner of a YouTube channel without the comment scope to reconnect', () => {
    expect(commentStepReason({ identifier: 'youtube', canComment: false })).toBe('not_granted');
  });

  it('asks the owner of a TikTok channel to turn first comment on, where it is offered', () => {
    expect(commentStepReason({ identifier: 'tiktok', canComment: false, commentSetup: 'tiktok' })).toBe('not_enabled');
    expect(commentStepReason({ identifier: 'tiktok', canComment: false })).toBe('no_api');
  });
});
