// What the public API and the agent's media list return for a media row: the
// file itself. The library query also selects editor fields (thumbnail, alt,
// type, AI flag), which are not for API callers (upstream 4be38e1a, e7b8126b).
export const toPublicMedia = (media: {
  id: string;
  name: string;
  originalName: string | null;
  path: string;
  createdAt: Date;
}) => ({
  id: media.id,
  name: media.name,
  originalName: media.originalName,
  path: media.path,
  createdAt: media.createdAt,
});
