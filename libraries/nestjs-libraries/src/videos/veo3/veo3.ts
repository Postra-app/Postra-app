import { HttpException, Logger } from '@nestjs/common';
import {
  URL,
  Video,
  VideoAbstract,
} from '@gitroom/nestjs-libraries/videos/video.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
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

  // Optional: the clip is made from the description alone as well. The
  // composer always sends the list; the public API and the MCP tool with a
  // prompt only were refused with "images must be an array" (the same defect
  // upstream fixed for its Seedance model, #2291).
  @IsOptional()
  @Type(() => Image)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(3)
  images?: Image[];
}

// Veo 3.1 Lite through kie.ai's Market API (docs.kie.ai/veo3-api): 8 seconds
// with sound, 1080p, about $0.18 a clip (35 credits at $0.005, kie.ai/pricing
// 2026-11-14). Fast is the same call at 65 credits; Lite takes the reference
// pictures too. The older /api/v1/veo/* endpoints were Veo 3 at $0.40 and
// reported a failed clip only by never finishing, so a refused prompt held
// the request for ten minutes. KIEAI_API_URL points the stack tests at a fake.
const KIE_MODEL = 'veo3_lite';
const POLL_MS = 10_000;
// ~20 minutes. kie.ai usually finishes in one to three, but says some clips
// take longer than ten and to keep asking; a clip given up on is still made
// and charged there.
const MAX_POLLS = 120;
// One answer that did not arrive (a timeout, a 429, a gateway page) is not
// the clip failing: it used to end the job, hand the credit back and leave
// kie.ai making a clip nobody would collect. Only this many in a row do.
const MAX_POLL_ERRORS = 6;
// kie.ai does not queue a task it refused with 429 (20 new tasks in 10 s per
// account), so it is asked again.
const CREATE_ATTEMPTS = 3;
const CREATE_RETRY_MS = 3_000;

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
    return this.finish(await this.start(output, customParams));
  }

  /** Asks kie.ai for the clip and returns its task id. */
  override async start(
    output: 'vertical' | 'horizontal',
    customParams: Veo3Params
  ): Promise<string> {
    const images = (customParams?.images || []).map((p) => p.path);
    const body = JSON.stringify({
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
    });

    let created: any;
    for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++) {
      // kie.ai answers errors with HTTP 200 and the code in the body.
      created = (await (
        await fetch(kieUrl('/api/v1/jobs/createTask'), {
          headers: kieHeaders(),
          method: 'POST',
          body,
          signal: AbortSignal.timeout(60_000),
        })
      ).json()) as any;
      if (created?.code !== 429 || attempt === CREATE_ATTEMPTS) {
        break;
      }
      await timer(CREATE_RETRY_MS * attempt);
    }

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

    return String(created.data.taskId);
  }

  /** Waits for a kie.ai task and returns where the clip is. */
  override async finish(taskId: string): Promise<URL> {
    let pollErrors = 0;
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      if (poll) {
        await timer(POLL_MS);
      }
      let info: any;
      let problem = '';
      try {
        info = await (
          await fetch(
            kieUrl(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`),
            { headers: kieHeaders(), signal: AbortSignal.timeout(30_000) }
          )
        ).json();
        if (info?.code !== 200) {
          problem = `${info?.code}: ${info?.msg}`;
        }
      } catch (err) {
        problem = (err as Error)?.name || 'no answer';
      }

      if (problem) {
        pollErrors++;
        if (pollErrors >= MAX_POLL_ERRORS) {
          throw new Error(
            `kie.ai recordInfo for task ${taskId} failed ${pollErrors} times in a row (${problem})`
          );
        }
        this._logger.warn(`kie.ai recordInfo for task ${taskId}: ${problem}`);
        continue;
      }
      pollErrors = 0;

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
