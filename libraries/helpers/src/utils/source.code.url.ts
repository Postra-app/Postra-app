export const SOURCE_REPOSITORY = 'https://github.com/Postra-app/Postra-app';

// The AGPL-3.0 offer (section 13) is for the source of the version the user
// is running, so the link points at that commit when the build knows it
// (NEXT_PUBLIC_VERSION, set from GITHUB_SHA by the deploy), and at the
// repository otherwise.
export const sourceCodeUrl = (version?: string | null) =>
  version && /^[0-9a-f]{7,40}$/i.test(version)
    ? `${SOURCE_REPOSITORY}/tree/${version}`
    : SOURCE_REPOSITORY;
