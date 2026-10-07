// isomorphic-dompurify 4 runs DOMPurify on jsdom 30, whose own dependencies
// ship ES modules only. Node 22.12+ loads them with require(), so production
// is fine (and the stack tests run the real thing); Jest 29 cannot. Specs get
// the same DOMPurify on the jsdom from devDependencies instead.
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const DOMPurify = createDOMPurify(new JSDOM('').window);
module.exports = DOMPurify;
module.exports.default = DOMPurify;
