import { config as zodConfig } from 'zod';

// Runs before the app's modules in the browser (Next instrumentation-client).
// zod 4 compiles object parsers with new Function once it has checked that
// eval is allowed, and that check alone is a CSP violation (script-src has no
// 'unsafe-eval'): every page reported one once CopilotKit, whose schemas are
// built when its modules load, sat in the app shell. Without the compiler zod
// parses the same, a little slower.
zodConfig({ jitless: true });
