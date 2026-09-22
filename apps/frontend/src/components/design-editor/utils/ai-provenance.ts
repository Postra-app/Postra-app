/**
 * Whether a design carries AI-generated pixels.
 *
 * Every Studio export goes through `/media/upload-simple`, which knows nothing
 * about how the picture was made, so an AI design landed in the library as
 * `aiGenerated: false` and YouTube and TikTok posts went out without their AI
 * label (E2E-06-04). The canvas knows: AI layers carry `studioAiGenerated`,
 * which is serialised with the design, so the answer is read from the same
 * JSON that is saved next to the picture.
 */
type Node = { studioAiGenerated?: boolean; objects?: Node[] };

const hasAiLayer = (nodes: Node[] | undefined): boolean =>
  !!nodes?.some((n) => n?.studioAiGenerated === true || hasAiLayer(n?.objects));

export const canvasJsonHasAi = (canvasJson: string | null | undefined) => {
  if (!canvasJson) return false;
  try {
    const parsed = JSON.parse(canvasJson) as Node & { backgroundImage?: Node };
    return (
      hasAiLayer(parsed.objects) ||
      parsed.backgroundImage?.studioAiGenerated === true
    );
  } catch {
    return false;
  }
};

/** Adds the flag the upload route records, only when it is true. */
export const markAiGenerated = (formData: FormData, canvasJson?: string | null) => {
  if (canvasJsonHasAi(canvasJson)) formData.append('aiGenerated', 'true');
};
