import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';

// The public API lives under /api on app.postra.pl; without it every call
// landed on the web app and came back as a redirect to the login page.
export const DEFAULT_BASE_URL = 'https://app.postra.pl/api';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

function toQueryString(obj: Record<string, any>): string {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export class PostraError extends Error {
  constructor(public status: number, public body: unknown) {
    super(
      `Postra API responded ${status}: ${
        typeof body === 'string' ? body : JSON.stringify(body)
      }`
    );
    this.name = 'PostraError';
  }
}

export default class Postra {
  private _baseUrl: string;

  constructor(private _apiKey: string, baseUrl = DEFAULT_BASE_URL) {
    // A loop, not /\/+$/: that regex is quadratic on input full of slashes.
    let url = baseUrl;
    while (url.endsWith('/')) url = url.slice(0, -1);
    this._baseUrl = url;
  }

  private async request(path: string, init: RequestInit = {}) {
    const res = await fetch(`${this._baseUrl}/public/v1${path}`, {
      ...init,
      redirect: 'manual',
      headers: { Authorization: this._apiKey, ...(init.headers || {}) },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // not JSON — keep the text for the error message
    }
    if (!res.ok) {
      throw new PostraError(res.status, body);
    }
    return body as any;
  }

  post(posts: CreatePostDto) {
    return this.request('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posts),
    });
  }

  postList(filters: GetPostsDto) {
    return this.request(`/posts?${toQueryString(filters)}`);
  }

  upload(file: Buffer, extension: string) {
    const ext = extension.replace(/^\./, '').toLowerCase();
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([file], { type: MIME_TYPES[ext] || 'application/octet-stream' }),
      `upload.${ext}`
    );
    return this.request('/upload', { method: 'POST', body: formData });
  }

  integrations() {
    return this.request('/integrations');
  }

  deletePost(id: string) {
    return this.request(`/posts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
