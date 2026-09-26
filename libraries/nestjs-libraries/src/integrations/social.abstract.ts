import { timer } from '@gitroom/helpers/utils/timer';
import { Integration } from '@prisma/client';
import { ApplicationFailure } from '@temporalio/activity';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import sharp from 'sharp';

export type ValidityMedia = {
  path: string;
  thumbnail?: string;
};

// Temporal serializes the whole ApplicationFailure (message + details) into the
// workflow history and ships it over gRPC, which has a hard 4MB frame limit.
// Provider error bodies can be huge (full HTML error pages, base64 media echoed
// back, stack traces), so every string that goes into a failure is capped — one
// oversized error would otherwise fail the whole workflow with
// "GRPC Message too large" instead of surfacing the real publish error.
const MAX_FAILURE_MESSAGE = 2_000;
const MAX_FAILURE_FIELD = 4_000;

export function truncateForTemporal(value: any, max: number): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = typeof value === 'string' ? value : safeStringify(value);
  if (str.length <= max) {
    return str;
  }

  return `${str.slice(0, max)}… [truncated ${str.length - max} chars]`;
}

export class RefreshToken extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(truncateForTemporal(message, MAX_FAILURE_MESSAGE), 'refresh_token', true, [
      {
        identifier,
        json: truncateForTemporal(json, MAX_FAILURE_FIELD),
        body: truncateForTemporal(body, MAX_FAILURE_FIELD),
      },
    ]);
  }
}

export class BadBody extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(truncateForTemporal(message, MAX_FAILURE_MESSAGE), 'bad_body', true, [
      {
        identifier,
        json: truncateForTemporal(json, MAX_FAILURE_FIELD),
        body: truncateForTemporal(body, MAX_FAILURE_FIELD),
      },
    ]);
  }
}

// Thrown when the platform accepted our upload but its media processing did
// not finish inside the activity budget. nonRetryable: the post may already
// be live on the platform, and an automatic retry of the whole publish is
// exactly how duplicate posts happen (H1). The workflow surfaces it as a
// regular publish error and the post ends in ERROR for the user to check.
export class ProcessingTimeout extends ApplicationFailure {
  constructor(identifier: string, message = '') {
    super(
      message || `${identifier}: media processing did not finish in time`,
      'processing_timeout',
      true,
      [{ identifier }]
    );
  }
}

export class NotEnoughScopes {
  constructor(
    public message = 'Not enough scopes, when choosing a provider, please add all the scopes'
  ) {}
}

// Strips token-ish query params / JSON fields so full URLs and bodies can be
// logged without leaking credentials (Meta puts access_token in the query string).
export function sanitizeSecrets(text: string) {
  return (text || '').replace(
    /(access_token|refresh_token|appsecret_proof|client_secret|api_key|token)(=|":\s*")([^&\s"']+)/gi,
    '$1$2***'
  );
}

// Pulls the human sentence out of a platform's error body, so a provider
// without its own handleErrors still tells the user why (Mastodon's "Cannot
// attach more than four files" used to reach the email as "Unknown Error").
export function providerErrorMessage(json: string): string | undefined {
  let body: any;
  try {
    body = JSON.parse(json || '{}');
  } catch {
    return undefined;
  }

  const candidates = [
    body?.error?.error_user_msg,
    body?.error?.message,
    body?.error,
    body?.error_description,
    body?.message,
    body?.errors?.[0]?.message,
    body?.errors?.[0]?.detail,
    body?.detail,
  ];
  const found = candidates.find(
    (c) => typeof c === 'string' && c.trim().length > 0
  );

  return found ? sanitizeSecrets(found.trim()).slice(0, 300) : undefined;
}

function safeStringify(obj: any) {
  const seen = new WeakSet();

  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

export abstract class SocialAbstract {
  abstract identifier: string;
  maxConcurrentJob = 1;

  public handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return undefined;
  }

  /**
   * Server-side replacement for the old client-side `checkValidity`.
   * Validates the media attached to a post (and its comments) against the
   * provider rules. Returns `true` when valid, or an error message string.
   *
   * `posts` mirrors the client shape: the outer array is the main post followed
   * by each comment, the inner array is the media items for that entry.
   *
   * Note: video-duration validations that used to run in the browser are not
   * re-implemented here (no ffmpeg dependency). Image-dimension checks use sharp.
   */
  async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true> {
    return true;
  }

  /** Reads the pixel dimensions of an image via sharp (works for http or local paths). */
  protected async getImageDimensions(
    path: string
  ): Promise<{ width: number; height: number }> {
    // Stored media paths are relative (e.g. "uploads/x.png"); resolve them to a
    // fetchable URL the same way posts.service.updateMedia does.
    const url =
      path?.indexOf('http') === -1
        ? `${process.env.FRONTEND_URL}/${path}`
        : path;
    const { width = 0, height = 0 } = await sharp(await readOrFetch(url), {
      limitInputPixels: 100_000_000,
    }).metadata();
    return { width, height };
  }

  public async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ): Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  > {
    return { none: true };
  }

  async runInConcurrent<T>(
    func: (...args: any[]) => Promise<T>,
    ignoreConcurrency?: boolean
  ) {
    let globalErr = {};
    let value: any;
    try {
      value = await func();
    } catch (err) {
      const handle = this.handleErrors(safeStringify(err), 200);
      console.error(
        `[social:${this.identifier}] provider call threw handled=${
          handle ? `${handle.type} (${handle.value})` : 'none'
        } error=${sanitizeSecrets(safeStringify(err)).slice(0, 4000)}`
      );
      value = { err: true, value: 'Unknown Error', ...(handle || {}) };
      globalErr = err;
    }

    if (value && value?.err && value?.value) {
      if (value.type === 'refresh-token') {
        throw new RefreshToken(
          '',
          safeStringify({}),
          {} as any,
          value.value || ''
        );
      }
      throw new BadBody('', safeStringify(globalErr), {} as any, value.value || '');
    }

    return value;
  }

  async fetch(
    url: string,
    options: RequestInit = {},
    identifier = '',
    totalRetries = 0,
    ignoreConcurrency = false,
    message = '',
  ): Promise<Response> {
    // Social APIs occasionally hang forever; without a signal the fetch pins
    // the Temporal activity until startToClose. 120s accommodates slow media
    // uploads while still bounding the call. Callers may pass their own signal.
    const request = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(120_000),
    });

    if (request.status === 200 || request.status === 201) {
      return request;
    }

    let json = '{}';
    try {
      json = await request.text();
    } catch (err) {
      json = '{}';
    }

    const handleError = this.handleErrors(json || '{}', request.status);

    // The raw platform response never survives into Temporal's "Activity failed"
    // log line (details render as [Object]), so this is the only place the real
    // error (e.g. Meta's error_subcode/error_user_msg) gets recorded.
    console.error(
      `[social:${this.identifier}] request failed status=${
        request.status
      } attempt=${totalRetries + 1} handled=${
        handleError ? `${handleError.type} (${handleError.value})` : 'none'
      } url=${sanitizeSecrets(url)} response=${sanitizeSecrets(json).slice(
        0,
        4000
      )}`
    );

    const reason =
      handleError?.value || providerErrorMessage(json) || 'Unknown Error';

    if (totalRetries > 2) {
      throw new BadBody(
        identifier,
        json,
        options.body || '{}',
        reason
      );
    }

    if (
      request.status === 429 ||
      (request.status === 500 && !handleError) ||
      json.includes('rate_limit_exceeded') ||
      json.includes('Rate limit')
    ) {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency,
        reason
      );
    }

    if (handleError?.type === 'retry') {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency,
        reason
      );
    }

    if (
      (request.status === 401 &&
        (handleError?.type === 'refresh-token' || !handleError)) ||
      handleError?.type === 'refresh-token'
    ) {
      throw new RefreshToken(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    throw new BadBody(
      identifier,
      json,
      options.body!,
      reason
    );
  }

  checkScopes(required: string[], got: string | string[]) {
    if (Array.isArray(got)) {
      if (!required.every((scope) => got.includes(scope))) {
        throw new NotEnoughScopes();
      }

      return true;
    }

    const newGot = decodeURIComponent(got);

    const splitType = newGot.indexOf(',') > -1 ? ',' : ' ';
    const gotArray = newGot.split(splitType);
    if (!required.every((scope) => gotArray.includes(scope))) {
      throw new NotEnoughScopes();
    }

    return true;
  }
}
