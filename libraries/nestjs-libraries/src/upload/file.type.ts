// What a file really is, from its first bytes (the magic number), so an
// upload cannot pass as an image by its name alone.
//
// file-type has been ESM-only since v17. Node 22.12+ loads an ES module with
// require(), so the backend keeps its CommonJS build; Jest, which cannot,
// transpiles the package instead (jest.config.ts). Every caller comes here so
// the next major changes one file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileTypeFromBuffer } = require('file-type');

export type DetectedFileType = { ext: string; mime: string };

export const fromBuffer = (
  buffer: Uint8Array | ArrayBuffer
): Promise<DetectedFileType | undefined> => fileTypeFromBuffer(buffer);
