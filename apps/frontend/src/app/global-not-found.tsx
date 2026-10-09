import type { Metadata } from 'next';

// Global 404 for URLs that match no route. Because the app uses multiple root
// layouts (route groups), this convention (gated by experimental.globalNotFound
// in next.config.js) is the only way to render a branded catch-all. It bypasses
// normal rendering, so it must return a full HTML document and carry its own
// styles — we keep them inline and minimal rather than pulling in global.scss.
export const metadata: Metadata = {
  title: 'Page not found - Postra',
  description: 'The page you are looking for does not exist.',
};

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0e1a',
          color: '#e5e7eb',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '420px' }}>
          <div
            style={{
              fontSize: '64px',
              fontWeight: 700,
              lineHeight: 1,
              background: 'linear-gradient(90deg, #38bdf8, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            404
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '20px 0 8px' }}>
            Page not found
          </h1>
          <p style={{ margin: '0 0 24px', color: '#9ca3af', fontSize: '15px' }}>
            The page you are looking for doesn&apos;t exist or has moved.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              borderRadius: '8px',
              background: '#38bdf8',
              color: '#0a0e1a',
              fontWeight: 600,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            Back to Postra
          </a>
        </div>
      </body>
    </html>
  );
}
