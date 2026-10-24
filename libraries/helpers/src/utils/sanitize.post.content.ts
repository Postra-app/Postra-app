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

  return DOMPurify.sanitize(paragraphs, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
    // DOMPurify checks every attribute that is not "URI-safe" against the
    // URI pattern above, so dir="auto" and rel="noopener" were dropped
    // although listed. `target` stays out: a kept target="_blank" without a
    // forced rel would let a public preview's link reach back (tabnabbing).
    ADD_URI_SAFE_ATTR: ['dir', 'rel'],
  });
};
