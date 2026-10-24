import {
  CreatePostDto,
  Post,
  PostContent,
} from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';

// What the API accepts, not the server's DTO classes as written: those mark
// fields the API treats as optional as required, so the README example did
// not compile in strict TypeScript (E2E-08-56).
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type PostValueInput = Optional<PostContent, 'id' | 'delay'>;
export type PostInput = Optional<Omit<Post, 'value'>, 'group' | 'settings'> & {
  value: PostValueInput[];
};
export type CreatePostInput = Omit<CreatePostDto, 'posts'> & {
  posts: PostInput[];
};
export type GetPostsInput = Optional<GetPostsDto, 'customer'>;

// The public API lives under /api on app.postra.co.uk; without it every call
// landed on the web app and came back as a redirect to the login page.
export const DEFAULT_BASE_URL = 'https://app.postra.co.uk/api';

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

  post(posts: CreatePostInput) {
    return this.json('/posts', 'POST', posts);
  }

  postList(filters: GetPostsInput) {
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

  // The media library, newest first, 18 per page; reuse a path as a post's
  // image instead of uploading the file again.
  mediaList(filters: { page?: number; search?: string } = {}) {
    return this.request(`/media?${toQueryString(filters)}`);
  }

  // Postra downloads the file from a public HTTPS address into the media
  // library; the answer is the same media object as upload().
  uploadFromUrl(url: string) {
    return this.json('/upload-from-url', 'POST', { url });
  }

  integrations() {
    return this.request('/integrations');
  }

  // { connected: true } when the key works.
  isConnected() {
    return this.request('/is-connected');
  }

  // What a channel accepts: rules, maxLength, the settings schema and tools.
  integrationSettings(id: string) {
    return this.request(`/integration-settings/${encodeURIComponent(id)}`);
  }

  // Runs one of the channel's tools (from integrationSettings().tools).
  triggerIntegration(
    id: string,
    methodName: string,
    data: Record<string, string> = {}
  ) {
    return this.json(`/integration-trigger/${encodeURIComponent(id)}`, 'POST', {
      methodName,
      data,
    });
  }

  // The sign-in address that connects a new channel of that platform; open it
  // in a browser where a member of the organisation is signed in to Postra.
  connectChannel(platform: string, options: { refresh?: string } = {}) {
    return this.request(
      `/social/${encodeURIComponent(platform)}?${toQueryString(options)}`
    );
  }

  // Removes the channel and every post on it.
  deleteIntegration(id: string) {
    return this.request(`/integrations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  deletePost(id: string) {
    return this.request(`/posts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Deletes every post that shares the group value from postList().
  deletePostGroup(group: string) {
    return this.request(`/posts/group/${encodeURIComponent(group)}`, {
      method: 'DELETE',
    });
  }

  // 'draft' takes a post out of the queue, 'schedule' puts it back; a post
  // that was already published needs republish: true to go out again.
  setPostStatus(
    id: string,
    status: 'draft' | 'schedule',
    options: { republish?: boolean } = {}
  ) {
    return this.json(`/posts/${encodeURIComponent(id)}/status`, 'PUT', {
      status,
      ...options,
    });
  }

  // The channel's recent items on the platform, for a post the platform
  // published without telling Postra its id.
  postMissing(id: string) {
    return this.request(`/posts/${encodeURIComponent(id)}/missing`);
  }

  // Links such a post to one of those items.
  setReleaseId(id: string, releaseId: string) {
    return this.json(`/posts/${encodeURIComponent(id)}/release-id`, 'PUT', {
      releaseId,
    });
  }

  // The next free posting time on the channel, in UTC; use it as date in post().
  findSlot(integrationId: string) {
    return this.request(`/find-slot/${encodeURIComponent(integrationId)}`);
  }

  // Channel analytics over the last `date` days (default 7).
  analytics(integrationId: string, options: { date?: number } = {}) {
    return this.request(
      `/analytics/${encodeURIComponent(integrationId)}?${toQueryString(
        options
      )}`
    );
  }

  // Analytics of one published post over the last `date` days (default 7).
  postAnalytics(postId: string, options: { date?: number } = {}) {
    return this.request(
      `/analytics/post/${encodeURIComponent(postId)}?${toQueryString(options)}`
    );
  }

  // The organisation's notifications, newest first, 100 per page from page 0.
  notifications(options: { page?: number } = {}) {
    return this.request(`/notifications?${toQueryString(options)}`);
  }

  private json(path: string, method: 'POST' | 'PUT', body: unknown) {
    return this.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
