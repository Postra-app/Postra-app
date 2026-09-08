/**
 * `disposable-email-domains` ships a plain `index.js` that re-exports a JSON
 * array of hostnames. It carries no types of its own and there is no @types
 * package for it, so declare the shape we actually consume.
 */
declare module 'disposable-email-domains' {
  const domains: string[];
  export default domains;
}
