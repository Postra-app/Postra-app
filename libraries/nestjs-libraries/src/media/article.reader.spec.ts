const fetchMock = jest.fn();
jest.mock('undici', () => ({ ...jest.requireActual('undici'), fetch: (...a: unknown[]) => fetchMock(...a) }));
const safeMock = jest.fn();
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: (...a: unknown[]) => safeMock(...a),
}));

import {
  ARTICLE_MAX_BYTES,
  ARTICLE_PROMPT_CHARS,
  ARTICLE_UNREADABLE,
  articleFromHtml,
  articlePrompt,
  readArticle,
} from './article.reader';

const body = 'Postra plans a month of posts in one afternoon. '.repeat(10);
const page = (inner: string, head = '') =>
  `<html><head><title>Tab title</title>${head}</head><body>${inner}</body></html>`;
const html = (text: string, type = 'text/html; charset=utf-8', status = 200) =>
  new Response(text, { status, headers: { 'content-type': type } });

beforeEach(() => {
  fetchMock.mockReset();
  safeMock.mockReset().mockResolvedValue(true);
});

describe('articleFromHtml', () => {
  it('keeps the article and drops the page around it', () => {
    const a = articleFromHtml(
      page(
        `<nav>Pricing Docs Login</nav><article><header><h1>Launch week</h1></header><p>${body}</p>` +
          '<script>track("x")</script><form>Subscribe now</form></article><footer>Cookie settings</footer>',
        '<meta property="og:title" content="Launch week at Postra">'
      )
    );
    expect(a.title).toBe('Launch week at Postra');
    expect(a.text).toContain('Launch week\n');
    expect(a.text).toContain('one afternoon.');
    for (const gone of ['Pricing', 'track', 'Subscribe', 'Cookie']) {
      expect(a.text).not.toContain(gone);
    }
  });

  it('reads a page with no <article> from its body, without header and footer', () => {
    const a = articleFromHtml(page(`<header>Menu</header><h1>Hello</h1><p>${body}</p><footer>Legal</footer>`));
    expect(a.title).toBe('Tab title');
    expect(a.text.startsWith('Hello\n')).toBe(true);
    expect(a.text).not.toContain('Menu');
    expect(a.text).not.toContain('Legal');
  });
  it('bounds the title like the text: a page can put anything in its <title>', () => {
    const a = articleFromHtml(page(`<p>${body}</p>`, `<meta property="og:title" content="${'T'.repeat(50000)}">`));
    expect(a.title).toHaveLength(200);
    expect(articlePrompt(a).length).toBeLessThan(ARTICLE_PROMPT_CHARS + 600);
  });
});

describe('readArticle', () => {
  it('returns the article of a public page', async () => {
    fetchMock.mockResolvedValue(html(page(`<article><p>${body}</p></article>`)));
    const a = await readArticle('https://blog.example/post');
    expect(a.text).toContain('one afternoon.');
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
  });

  const refused = async (p: Promise<unknown>) => {
    await expect(p).rejects.toMatchObject({ status: 422, message: ARTICLE_UNREADABLE });
  };

  it('never fetches an address that is not public https', async () => {
    safeMock.mockResolvedValue(false);
    await refused(readArticle('https://169.254.169.254/latest/meta-data'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a page with no article to read, instead of inventing one', async () => {
    fetchMock.mockResolvedValue(html(page('<div id="app"></div><script>render()</script>')));
    await refused(readArticle('https://blog.example/spa'));
  });

  it('refuses what is not a web page, an error page, and a dead server', async () => {
    fetchMock.mockResolvedValueOnce(html('%PDF-1.7', 'application/pdf'));
    await refused(readArticle('https://blog.example/a.pdf'));
    fetchMock.mockResolvedValueOnce(html(page(`<p>${body}</p>`), 'text/html', 404));
    await refused(readArticle('https://blog.example/gone'));
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await refused(readArticle('https://blog.example/down'));
  });

  it('stops reading a page that never ends', async () => {
    fetchMock.mockResolvedValue(html(page(`<p>${'x'.repeat(ARTICLE_MAX_BYTES + 10)}</p>`)));
    await refused(readArticle('https://blog.example/huge'));
  });
});

describe('articlePrompt', () => {
  it('hands the model a bounded article, marked as material and not as instructions', () => {
    const p = articlePrompt({ title: 'T', text: 'a'.repeat(ARTICLE_PROMPT_CHARS * 3) }, '  for agencies ');
    expect(p).toContain('What the user asked for: for agencies\n');
    expect(p).toContain('not instructions');
    expect(p).toContain('<article>\nTitle: T\n');
    expect(p.length).toBeLessThan(ARTICLE_PROMPT_CHARS + 400);
  });

  it('leaves the note line out when the user gave only a link', () => {
    expect(articlePrompt({ title: '', text: 'abc' })).not.toContain('asked for');
  });
});
