/**
 * Photographer credits a design carries.
 *
 * A photo from Unsplash put on the canvas keeps its "Photo by <name> on
 * Unsplash" line in `studioCredit`, which is serialised with the design. The
 * export is a new picture that knows nothing of where its pixels came from,
 * so the lines are read from the same JSON that is saved next to it and sent
 * with the upload; the composer adds them to the post text.
 */
type Node = { studioCredit?: unknown; objects?: Node[] };

const collect = (nodes: Node[] | undefined, out: string[]) => {
  for (const n of nodes || []) {
    const credit = typeof n?.studioCredit === 'string' ? n.studioCredit.trim() : '';
    if (credit && !out.includes(credit)) out.push(credit);
    collect(n?.objects, out);
  }
};

export const canvasJsonCredits = (canvasJson: string | null | undefined): string[] => {
  if (!canvasJson) return [];
  try {
    const parsed = JSON.parse(canvasJson) as Node & { backgroundImage?: Node };
    const out: string[] = [];
    collect(parsed.backgroundImage ? [parsed.backgroundImage] : [], out);
    collect(parsed.objects, out);
    return out;
  } catch {
    return [];
  }
};

/** Adds the credit lines the upload route records, only when there are any. */
export const markCredits = (formData: FormData, canvasJson?: string | null) => {
  const credits = canvasJsonCredits(canvasJson);
  if (credits.length) formData.append('credit', credits.join('\n'));
};
