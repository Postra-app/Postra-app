// The literal "Geist" family the canvas draws with. `next/font` gives the app
// shell a hashed family name that changes every build, which a saved design
// cannot reference.
import './geist-canvas.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/700.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/700.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/pacifico/400.css';

export interface StudioFont {
  key: string;
  label: string;
  family: string;
  classification: 'sans' | 'serif' | 'display' | 'mono' | 'handwriting';
}

export const STUDIO_FONTS: StudioFont[] = [
  {
    key: 'geist',
    label: 'Geist',
    family: 'Geist, system-ui, sans-serif',
    classification: 'sans',
  },
  {
    key: 'inter',
    label: 'Inter',
    family: 'Inter, sans-serif',
    classification: 'sans',
  },
  {
    key: 'roboto',
    label: 'Roboto',
    family: 'Roboto, sans-serif',
    classification: 'sans',
  },
  {
    key: 'open-sans',
    label: 'Open Sans',
    family: '"Open Sans", sans-serif',
    classification: 'sans',
  },
  {
    key: 'lato',
    label: 'Lato',
    family: 'Lato, sans-serif',
    classification: 'sans',
  },
  {
    key: 'montserrat',
    label: 'Montserrat',
    family: 'Montserrat, sans-serif',
    classification: 'sans',
  },
  {
    key: 'poppins',
    label: 'Poppins',
    family: 'Poppins, sans-serif',
    classification: 'sans',
  },
  {
    key: 'dm-sans',
    label: 'DM Sans',
    family: '"DM Sans", sans-serif',
    classification: 'sans',
  },
  {
    key: 'bebas-neue',
    label: 'Bebas Neue',
    family: '"Bebas Neue", Impact, sans-serif',
    classification: 'display',
  },
  {
    key: 'oswald',
    label: 'Oswald',
    family: 'Oswald, Impact, sans-serif',
    classification: 'display',
  },
  {
    key: 'playfair-display',
    label: 'Playfair Display',
    family: '"Playfair Display", Georgia, serif',
    classification: 'serif',
  },
  {
    key: 'caveat',
    label: 'Caveat',
    family: 'Caveat, cursive',
    classification: 'handwriting',
  },
  {
    key: 'pacifico',
    label: 'Pacifico',
    family: 'Pacifico, cursive',
    classification: 'handwriting',
  },
  {
    key: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", "Courier New", monospace',
    classification: 'mono',
  },
];

export const DEFAULT_FONT = STUDIO_FONTS[0];

/** Every family Studio can draw with, for a one-shot warm-up. */
export const ALL_FONT_FAMILIES = STUDIO_FONTS.map((f) => f.family);

export const findFontByFamily = (family?: string): StudioFont => {
  if (!family) return DEFAULT_FONT;
  const match = STUDIO_FONTS.find((f) =>
    family.toLowerCase().includes(f.label.toLowerCase())
  );
  return match || DEFAULT_FONT;
};
