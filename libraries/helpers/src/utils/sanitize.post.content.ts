import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'u',
  'a',
  'ul',
  'li',
  'h1',
  'h2',
  'h3',
  'span',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'class',
  // dir="auto" on paragraphs: right-to-left text (upstream 75cb2f83).
  'dir',
  'data-mention-id',
  'data-mention-label',
];

const POST_CLASSES = new Set(['mention']);

export const sanitizePostContent = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  // A block tag the editor does not know (div, section, blockquote, pre,
  // h4-h6) was dropped with its text kept, gluing its line to the next one
  // in posts sent through the API, MCP or pasted as HTML (upstream
  // 14e5a4679). `[^<>]*`, not `[^>]*`: an unclosed tag made the latter
  // quadratic on a long body (upstream 2ded21d14).
  const paragraphs = value.replace(
    /<(\/?)(div|section|article|blockquote|pre|h[4-6])\b[^<>]*>/gi,
    '<$1p>'
  );

  // The editor writes one class, on a mention. Any other came from HTML sent
  // through the API or pasted, and the app's own stylesheet answers to it:
  // class="fixed top-0 w-full h-full z-[900] ..." on a link made a
  // full-screen "sign in again" over the public preview of a post, on this
  // site's address. Done on the attribute as DOMPurify meets it, not on the
  // text it returns: a post that says class="foo" in its words keeps them.
  const onlyPostClasses = (_node: unknown, data: any) => {
    if (data?.attrName !== 'class') {
      return;
    }
    const kept = String(data.attrValue || '')
      .split(/\s+/)
      .filter((n) => POST_CLASSES.has(n));
    if (kept.length) {
      data.attrValue = kept.join(' ');
    } else {
      data.keepAttr = false;
    }
  };
  DOMPurify.addHook?.('uponSanitizeAttribute', onlyPostClasses);
  try {
    return DOMPurify.sanitize(paragraphs, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      // A path on this site starts with one slash. "//host" and "/\\host"
      // are other sites to a browser and passed as paths.
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?![\/\\])|#)/i,
      // DOMPurify checks every attribute that is not "URI-safe" against the
      // URI pattern above, so dir="auto" and rel="noopener" were dropped
      // although listed. `target` stays out: a kept target="_blank" without
      // a forced rel would let a public preview's link reach back
      // (tabnabbing).
      ADD_URI_SAFE_ATTR: ['dir', 'rel'],
    });
  } finally {
    DOMPurify.removeHook?.('uponSanitizeAttribute');
  }
};
