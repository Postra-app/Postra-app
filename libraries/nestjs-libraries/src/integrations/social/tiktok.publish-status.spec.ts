import { TiktokProvider } from './tiktok.provider';

// TikTok's publish/status/fetch answers publicaly_available_post_id as an
// int64 array. JSON.parse rounds anything past 2^53, so the stored release id
// and the post link lost their last digits (upstream 634c6da1). Posts that
// finish moderation after publishing keep the publish id; resolveReleaseId
// turns it into the real post id and link later (upstream bcbc1195, da7f7a18,
// 4637a519).
describe('TikTok publish status', () => {
  const realFetch = global.fetch;
  // 19 digits, past Number.MAX_SAFE_INTEGER: JSON.parse gives ...011000
  const publicId = '7558123456789011234';

  const respondRaw = (raw: string) => {
    global.fetch = jest.fn(
      async () =>
        new Response(raw, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as any;
  };

  // Shape from TikTok's Content Posting API reference (post/publish/status/fetch).
  const complete = (ids: string) =>
    `{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[${ids}],"uploaded_bytes":0},"error":{"code":"ok","message":"","log_id":"20261009"}}`;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('keeps every digit of the public post id after publishing', async () => {
    respondRaw(complete(publicId));

    const result = await (new TiktokProvider() as any).uploadedVideoSuccess(
      'postra.co.uk',
      'v_pub_url~v2-1.123',
      'act.ok'
    );

    expect(result.id).toBe(publicId);
    expect(result.url).toBe(
      `https://www.tiktok.com/@postra.co.uk/video/${publicId}`
    );
  });

  it('keeps the publish id and links the profile while moderation is pending', async () => {
    respondRaw(complete(''));

    const result = await (new TiktokProvider() as any).uploadedVideoSuccess(
      'postra.co.uk',
      'v_pub_url~v2-1.123',
      'act.ok'
    );

    expect(result).toEqual({
      id: 'v_pub_url~v2-1.123',
      url: 'https://www.tiktok.com/@postra.co.uk',
    });
  });

  describe('resolveReleaseId', () => {
    const integration = { profile: 'postra.co.uk' } as any;

    it.each([
      ['v_pub_url~v2-1.123', 'video'],
      ['v_pub_file~v2-1.123', 'video'],
      ['p_pub_url~v2-1.123', 'photo'],
    ])('resolves %s to the full public id and its %s link', async (releaseId, kind) => {
      respondRaw(complete(publicId));

      await expect(
        new TiktokProvider().resolveReleaseId('act.ok', releaseId, integration)
      ).resolves.toEqual({
        postId: publicId,
        releaseURL: `https://www.tiktok.com/@postra.co.uk/${kind}/${publicId}`,
      });
    });

    it('leaves an already resolved id alone without asking TikTok', async () => {
      respondRaw(complete(publicId));

      await expect(
        new TiktokProvider().resolveReleaseId('act.ok', publicId, integration)
      ).resolves.toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('has nothing to resolve while TikTok has no public id yet', async () => {
      respondRaw(complete(''));

      await expect(
        new TiktokProvider().resolveReleaseId(
          'act.ok',
          'v_pub_url~v2-1.123',
          integration
        )
      ).resolves.toBeUndefined();
    });
  });

  it('queries video analytics with the full id', async () => {
    respondRaw('{"data":{"videos":[{"id":"x","view_count":5}]}}');

    await new TiktokProvider().postAnalytics('i1', 'act.ok', publicId, 7);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.filters.video_ids).toEqual([publicId]);
  });
});

// TikTok fails a whole photo post when one image is over 1080 px on the
// shorter side and never says which one (upstream 96e46cfe).
describe('TikTok media size', () => {
  const sized = (sizes: Array<[number, number]>) => {
    const provider = new TiktokProvider();
    const queue = [...sizes];
    jest
      .spyOn(provider as any, 'getImageDimensions')
      .mockImplementation(async () => {
        const [width, height] = queue.shift()!;
        return { width, height };
      });
    return provider;
  };

  it('names the oversized image in a carousel before saving', async () => {
    const provider = sized([
      [941, 1672],
      [1086, 1448],
    ]);

    await expect(
      provider.checkValidity([
        [
          { path: 'https://cdn/a.jpg' },
          { path: 'https://cdn/b.jpg' },
        ] as any,
      ])
    ).resolves.toBe(
      'Image 2 is 1086x1448, TikTok allows a maximum of 1080px on the shorter side'
    );
  });

  it('accepts images up to 1080 px on the shorter side', async () => {
    const provider = sized([
      [1080, 1350],
      [800, 1000],
    ]);

    await expect(
      provider.checkValidity([
        [{ path: 'https://cdn/a.jpg' }, { path: 'https://cdn/b.jpg' }] as any,
      ])
    ).resolves.toBe(true);
  });

  it('does not measure a video', async () => {
    const provider = sized([]);

    await expect(
      provider.checkValidity([[{ path: 'https://cdn/clip.mp4' }] as any])
    ).resolves.toBe(true);
  });

  it('explains picture_size_check_failed with the limits TikTok enforces', () => {
    expect(
      new TiktokProvider().handleErrors(
        '{"data":{"status":"FAILED","fail_reason":"picture_size_check_failed"}}'
      )?.value
    ).toBe(
      'Media size not supported by TikTok: images up to 1080px on the shorter side, videos at least 360px on both sides'
    );
  });
});
