// JSZip's self-contained browser build has no types of its own; it is the
// same API as the package entry.
declare module 'jszip/dist/jszip.min.js' {
  import JSZip from 'jszip';
  export default JSZip;
}
