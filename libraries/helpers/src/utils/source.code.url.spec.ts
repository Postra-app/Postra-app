import { sourceCodeUrl, SOURCE_REPOSITORY } from './source.code.url';

// The settings card said "the complete source code of the version you are
// using" and linked main, which is only the running version between a deploy
// and the next merge.
describe('sourceCodeUrl', () => {
  it('points at the running commit when the build knows it', () => {
    expect(sourceCodeUrl('4b83bc699b4f0c1a9e6d2f3a5b7c8d9e0f1a2b3c')).toBe(
      `${SOURCE_REPOSITORY}/tree/4b83bc699b4f0c1a9e6d2f3a5b7c8d9e0f1a2b3c`
    );
  });

  it('falls back to the repository without a commit, and never builds a path from junk', () => {
    expect(sourceCodeUrl(undefined)).toBe(SOURCE_REPOSITORY);
    expect(sourceCodeUrl('')).toBe(SOURCE_REPOSITORY);
    expect(sourceCodeUrl('../evil')).toBe(SOURCE_REPOSITORY);
  });
});
