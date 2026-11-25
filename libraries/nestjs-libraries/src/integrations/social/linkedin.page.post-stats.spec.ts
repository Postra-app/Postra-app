jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { incr: jest.fn(async () => 1), expire: jest.fn(), get: jest.fn(async (): Promise<null> => null) },
}));

import { LinkedinPageProvider } from './linkedin.page.provider';

// The statistics of one LinkedIn Page post never loaded. LinkedIn takes a
// share URN in `shares` and a UGC post URN in `ugcPosts`, does not accept a
// time range together with either, and answers with lifetime totals that
// carry no `timeRange`. The request sent every post as `shares` with a time
// range: a UGC post was refused (400) and a share's answer crashed on the
// missing `timeRange`, so the customer saw "No statistics available".

const totals = {
  impressionCount: 120,
  uniqueImpressionsCount: 90,
  clickCount: 7,
  likeCount: 5,
  commentCount: 2,
  shareCount: 1,
  engagement: 0.125,
};

const withLinkedin = (statsElement: Record<string, unknown> | null) => {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('organizationalEntityShareStatistics')) {
      return new Response(JSON.stringify({ elements: statsElement ? [statsElement] : [] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ likesSummary: { totalLikes: 5 }, commentsSummary: { totalFirstLevelComments: 2 } }),
      { status: 200 }
    );
  }) as any;
  return calls;
};

describe('LinkedIn Page post statistics', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks for a share by `shares`, without a time range, and reads its totals', async () => {
    const calls = withLinkedin({ share: 'urn:li:share:1', totalShareStatistics: totals });
    const result = await new LinkedinPageProvider().postAnalytics('117', 'token', 'urn:li:share:1', 7);
    const stats = calls.find((u) => u.includes('organizationalEntityShareStatistics'))!;
    expect(stats).toContain('/rest/organizationalEntityShareStatistics');
    expect(stats).toContain(`shares=List(${encodeURIComponent('urn:li:share:1')})`);
    expect(stats).not.toContain('timeIntervals');
    expect(stats).not.toContain('ugcPosts');
    const byLabel = Object.fromEntries(result.map((r) => [r.label, r.data[0].total]));
    expect(byLabel).toMatchObject({ Impressions: 120, Clicks: 7, Likes: 5, Comments: 2, Shares: 1, Engagement: 12.5 });
  });

  it('asks for a UGC post by `ugcPosts`', async () => {
    const calls = withLinkedin({ ugcPost: 'urn:li:ugcPost:2', totalShareStatistics: totals });
    const result = await new LinkedinPageProvider().postAnalytics('117', 'token', 'urn:li:ugcPost:2', 7);
    const stats = calls.find((u) => u.includes('organizationalEntityShareStatistics'))!;
    expect(stats).toContain(`ugcPosts=List(${encodeURIComponent('urn:li:ugcPost:2')})`);
    expect(stats).not.toContain('shares=');
    expect(result.find((r) => r.label === 'Unique Impressions')?.data[0].total).toBe(90);
  });

  it('a post LinkedIn has no numbers for yet shows its likes and comments', async () => {
    withLinkedin(null);
    const result = await new LinkedinPageProvider().postAnalytics('117', 'token', 'urn:li:share:3', 7);
    expect(Object.fromEntries(result.map((r) => [r.label, r.data[0].total]))).toEqual({ Likes: 5, Comments: 2 });
  });
});

describe('a comment on LinkedIn', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  // Post text is "little text format", where _ ( ) # @ are escaped. A
  // comment is plain text: escaped, a link showed as utm\_source and broke.
  it('is sent as written, with its link intact', async () => {
    let sent: any;
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ object: 'urn:li:comment:(1,2)' }), { status: 201 });
    }) as any;
    const provider = new LinkedinPageProvider() as any;
    await provider.createCommentPost(
      '117',
      'token',
      { message: 'How to (really) connect: https://postra.co.uk/docs/?utm_source=linkedin&utm_medium=social' },
      'urn:li:share:1',
      'company'
    );
    expect(sent.message.text).toBe(
      'How to (really) connect: https://postra.co.uk/docs/?utm_source=linkedin&utm_medium=social'
    );
  });
});
