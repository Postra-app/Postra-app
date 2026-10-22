import robots from './robots';

// app.postra.co.uk is the product, not a site to index: the login page and
// anything a crawler reaches must stay out of search results. Before this
// file /robots.txt was the 404 page (measured 2026-10-22, E2E-11-45).
describe('robots.txt', () => {
  it('disallows everything for every crawler', () => {
    const { rules } = robots();
    const list = Array.isArray(rules) ? rules : [rules];
    expect(list).toHaveLength(1);
    expect(list[0].userAgent).toBe('*');
    expect(list[0].disallow).toBe('/');
    expect(list[0].allow).toBeUndefined();
  });
});
