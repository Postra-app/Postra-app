// Node 22 defines Symbol.dispose for its own realm, but a jest test runs in a
// vm context whose Symbol lacks it (Node 24 has it everywhere). undici 8.11
// reads `addAbortListener(...)[Symbol.dispose]` from inside that context, gets
// undefined and throws "removeAbortListener is not a function" when a fetch
// ends or is aborted. Production runs plain Node and is not affected. Hand the
// test context the same symbol Node uses.
if (typeof Symbol.dispose === 'undefined') {
  const { addAbortListener } = require('node:events');
  const disposer = addAbortListener(new AbortController().signal, () => {});
  const [nodeDispose] = Object.getOwnPropertySymbols(disposer);
  if (nodeDispose) {
    Object.defineProperty(Symbol, 'dispose', { value: nodeDispose });
  }
  disposer[nodeDispose]?.();
}
