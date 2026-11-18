import { waitsForCommentStep } from '@gitroom/frontend/components/new-launch/comment-step';

describe('waitsForCommentStep', () => {
  it('is a TikTok channel without first comment turned on', () => {
    expect(waitsForCommentStep({ identifier: 'tiktok', canComment: false })).toBe(true);
  });

  it('is not a TikTok channel with first comment on, or an older payload', () => {
    expect(waitsForCommentStep({ identifier: 'tiktok', canComment: true })).toBe(false);
    expect(waitsForCommentStep({ identifier: 'tiktok' })).toBe(false);
  });

  it('is not a Facebook Page without the permission: its comment is sent and the failure reported', () => {
    expect(waitsForCommentStep({ identifier: 'facebook', canComment: false })).toBe(false);
  });
});
