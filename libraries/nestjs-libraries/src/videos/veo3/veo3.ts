import { HttpException, Logger } from '@nestjs/common';
import {
  URL,
  Video,
  VideoAbstract,
} from '@gitroom/nestjs-libraries/videos/video.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import { ArrayMaxSize, IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { fetch } from 'undici';

class Image {
  @IsString()
  id: string;

  @IsString()
  path: string;
}
class Veo3Params {
  @IsString()
  prompt: string;

  @Type(() => Image)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(3)
  images: Image[];
}

// Veo 3.1 Fast through kie.ai's Market API (docs.kie.ai/veo3-api): 8 seconds
// with sound, 1080p, about $0.33 a clip (65 credits at $0.005, 2026-10-08).
// The older /api/v1/veo/* endpoints were Veo 3 at $0.40 and reported a failed
// clip only by never finishing, so a refused prompt held the request for ten
// minutes. KIEAI_API_URL points the stack tests at a fake.
const KIE_MODEL = 'veo3_fast';
const POLL_MS = 10_000;
// ~10 minutes; kie.ai usually finishes in one to three.
const MAX_POLLS = 60;

const kieUrl = (path: string) =>
  `${(process.env.KIEAI_API_URL || 'https://api.kie.ai').replace(/\/+$/, '')}${path}`;

const kieHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.KIEAI_API_KEY}`,
});

const parseJson = (value: unknown): any => {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || '{}')) || {};
  } catch {
    return {};
  }
};

// Where the finished clip is. The Market API documents a top-level
// `resultUrls`, but for veo-3-1 kie.ai answers
// `{ code, data: { result_urls: [1080p], origin_urls: [720p] } }` — the first
// prod clip (2026-10-08) was paid for and then lost reading only the former.
// The same data also arrives under `response`.
export const videoUrlOf = (record: any): string | undefined => {
  const result = parseJson(record?.resultJson);
  const response = parseJson(record?.response);
  const candidates = [
    result?.resultUrls,
    result?.data?.result_urls,
    result?.data?.origin_urls,
    response?.data?.result_urls,
    response?.data?.origin_urls,
  ];
  for (const list of candidates) {
    const url = Array.isArray(list) ? list.find((u) => typeof u === 'string' && u) : undefined;
    if (url) return url;
  }
  return undefined;
};

@Video({
  identifier: 'veo3',
  title: 'Veo 3.1 (video with sound)',
  description: 'An 8-second video with sound from a description and up to 3 images.',
  placement: 'text-to-image',
  dto: Veo3Params,
  tools: [],
  // A trial gets one clip (trialAiAllowance), not none.
  trial: true,
  available: !!process.env.KIEAI_API_KEY,
})
export class Veo3 extends VideoAbstract<Veo3Params> {
  private readonly _logger = new Logger(Veo3.name);
  override dto = Veo3Params;
  override usageModel = KIE_MODEL;

  async process(
    output: 'vertical' | 'horizontal',
    customParams: Veo3Params
  ): Promise<URL> {
    const images = (customParams?.images || []).map((p) => p.path);
    const created = (await (
      await fetch(kieUrl('/api/v1/jobs/createTask'), {
        headers: kieHeaders(),
        method: 'POST',
        body: JSON.stringify({
          model: 'veo-3-1',
          input: {
            prompt: customParams.prompt,
            model: KIE_MODEL,
            // The pictures are what the clip is about (a product, a place),
            // not its first and last frame.
            ...(images.length
              ? { image_urls: images, generation_type: 'REFERENCE_2_VIDEO' }
              : { generation_type: 'TEXT_2_VIDEO' }),
            aspect_ratio: output === 'horizontal' ? '16:9' : '9:16',
            resolution: '1080p',
          },
        }),
        signal: AbortSignal.timeout(60_000),
      })
    ).json()) as any;

    if (created?.code !== 200 || !created?.data?.taskId) {
      // 401/402/429 are ours to fix (key, balance, rate) — the customer can
      // only try later. The credit goes back (useCredit refunds on throw).
      this._logger.error(
        `kie.ai createTask refused: ${created?.code} ${created?.msg}`
      );
      throw new HttpException(
        'AI video is unavailable right now. Please try again later.',
        503
      );
    }

    const taskId = created.data.taskId;
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      if (poll) {
        await timer(POLL_MS);
      }
      const info = (await (
        await fetch(
          kieUrl(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`),
          { headers: kieHeaders(), signal: AbortSignal.timeout(30_000) }
        )
      ).json()) as any;

      if (info?.code !== 200) {
        throw new Error(`kie.ai recordInfo ${info?.code}: ${info?.msg}`);
      }

      const state = info?.data?.state;
      if (state === 'fail') {
        this._logger.warn(
          `kie.ai task ${taskId} failed: ${info.data.failCode} ${info.data.failMsg}`
        );
        // Mostly a prompt or picture Google's filter refused.
        throw new HttpException(
          'The video model could not make this video. Try describing it differently, without real people, brands or anything explicit.',
          422
        );
      }

      if (state === 'success') {
        const url = videoUrlOf(info.data);
        if (!url) {
          // Paid for at kie.ai by now: name the task so the clip can still
          // be fetched by hand.
          throw new Error(
            `kie.ai task ${taskId} finished without a video URL we can read (resultJson keys: ${Object.keys(
              parseJson(info.data.resultJson)
            ).join(', ')})`
          );
        }
        return url;
      }

      this._logger.debug(`Waiting for video ${taskId} (${state})`);
    }

    throw new Error(`Timed out waiting for kie.ai task ${taskId}`);
  }
}
