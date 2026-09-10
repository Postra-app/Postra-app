import * as fabric from 'fabric';
import type { DesignTemplate, BrandStyle, TemplateLang } from './template-types';
import type { PlatformSize } from '../editor.store';
import { DEFAULT_FONT } from '../fonts';
import { ensureFontsLoaded } from '../utils/font-loading';

const pick = (lang: TemplateLang) => (pl: string, en: string) =>
  lang === 'pl' ? pl : en;

const clearCanvas = (canvas: fabric.Canvas, bg: string) => {
  canvas.getObjects().forEach((obj) => canvas.remove(obj));
  canvas.backgroundColor = bg;
};

// Every template positions elements with top-left math (bars at left:0/top:0,
// stacked top offsets), but Fabric v7 changed the DEFAULT origin to
// center/center — which silently shifted every element by half its size and
// broke layouts (cut-off bars, price overlapping its badge). Anchor the
// helpers to left/top; templates that want centering set originX explicitly.
const addTextbox = (
  canvas: fabric.Canvas,
  text: string,
  options: Partial<fabric.Textbox> & { fontFamily?: string }
): fabric.Textbox => {
  const tb = new fabric.Textbox(text, {
    fontFamily: 'Geist, system-ui, sans-serif',
    fill: '#ffffff',
    textAlign: 'center',
    editable: true,
    originX: 'left',
    originY: 'top',
    ...options,
  });
  canvas.add(tb);
  return tb;
};

const addRect = (
  canvas: fabric.Canvas,
  options: Partial<fabric.Rect>
): fabric.Rect => {
  const r = new fabric.Rect({ originX: 'left', originY: 'top', ...options });
  canvas.add(r);
  return r;
};

const addCircle = (
  canvas: fabric.Canvas,
  options: Partial<fabric.Circle>
): fabric.Circle => {
  const c = new fabric.Circle({ originX: 'left', originY: 'top', ...options });
  canvas.add(c);
  return c;
};

const promoModern: DesignTemplate = {
  key: 'promo-modern',
  category: 'promo',
  label: 'Modern Promo',
  labelPl: 'Promocja Modern',
  description: 'Headline with discount percent and CTA',
  descriptionPl: 'Nagłówek z procentem zniżki i CTA',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: 0,
      top: 0,
      width: p.width,
      height: p.height * 0.15,
      fill: brand.primary,
      selectable: false,
    });

    addTextbox(canvas, tx('PROMOCJA', 'SALE'), {
      left: cx,
      top: p.height * 0.045,
      width: p.width * 0.9,
      fontSize: p.width * 0.045,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 80,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '-50%', {
      left: cx,
      top: p.height * 0.32,
      width: p.width * 0.9,
      fontSize: p.width * 0.28,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Na wszystkie produkty', 'On all products'), {
      left: cx,
      top: p.height * 0.68,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.text,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.4,
      height: p.height * 0.08,
      fill: brand.primary,
      rx: p.height * 0.04,
      ry: p.height * 0.04,
      originX: 'center',
    });

    addTextbox(canvas, tx('Kup teraz', 'Shop now'), {
      left: cx,
      top: p.height * 0.84,
      width: p.width * 0.4,
      fontSize: p.width * 0.04,
      fill: brand.background,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });
  },
};

const quoteClassic: DesignTemplate = {
  key: 'quote-classic',
  category: 'quote',
  label: 'Classic Quote',
  labelPl: 'Cytat Klasyczny',
  description: 'Quote with author on a dark background',
  descriptionPl: 'Cytat z autorem na ciemnym tle',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '"', {
      left: cx,
      top: p.height * 0.12,
      width: p.width * 0.5,
      fontSize: p.width * 0.25,
      fill: brand.primary,
      originX: 'center',
      fontFamily: '"Playfair Display", Georgia, serif',
    });

    addTextbox(canvas, tx('Sukces to suma\nmałych wysiłków\npowtarzanych\ncodziennie.', 'Success is the sum\nof small efforts\nrepeated day in\nand day out.'), {
      left: cx,
      top: p.height * 0.38,
      width: p.width * 0.85,
      fontSize: p.width * 0.06,
      fill: brand.text,
      originX: 'center',
      fontStyle: 'italic',
      lineHeight: 1.3,
      fontFamily: '"Playfair Display", Georgia, serif',
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.78,
      width: p.width * 0.15,
      height: 2,
      fill: brand.primary,
      originX: 'center',
    });

    addTextbox(canvas, '— Robert Collier', {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.7,
      fontSize: p.width * 0.035,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const announcementBold: DesignTemplate = {
  key: 'announcement-bold',
  category: 'announcement',
  label: 'Bold Announcement',
  labelPl: 'Ogłoszenie Bold',
  description: 'Big headline with a two-line subtitle',
  descriptionPl: 'Duży nagłówek z dwuwierszowym podtytułem',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addCircle(canvas, {
      left: p.width * 0.05,
      top: p.height * 0.08,
      radius: p.width * 0.04,
      fill: brand.primary,
    });

    addTextbox(canvas, tx('NOWOŚĆ', 'NEW'), {
      left: p.width * 0.18,
      top: p.height * 0.1,
      width: p.width * 0.5,
      fontSize: p.width * 0.04,
      fill: brand.primary,
      textAlign: 'left',
      fontWeight: 'bold',
      charSpacing: 80,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Nowy\nprodukt\njuż dostępny', 'New\nproduct\nout now'), {
      left: cx,
      top: p.height * 0.28,
      width: p.width * 0.9,
      fontSize: p.width * 0.13,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.05,
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addTextbox(canvas, tx('Sprawdź szczegóły na naszej stronie i zamów przed innymi.', 'Check our website for details and order before everyone else.'), {
      left: cx,
      top: p.height * 0.78,
      width: p.width * 0.8,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.8,
      fontFamily: brand.fontFamily,
    });
  },
};

const statsHighlight: DesignTemplate = {
  key: 'stats-highlight',
  category: 'stats',
  label: 'Stats Highlight',
  labelPl: 'Statystyki Highlight',
  description: 'Big number with a caption',
  descriptionPl: 'Duża liczba z opisem',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '12K+', {
      left: cx,
      top: p.height * 0.25,
      width: p.width * 0.9,
      fontSize: p.width * 0.34,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.62,
      width: p.width * 0.12,
      height: 3,
      fill: brand.text,
      originX: 'center',
    });

    addTextbox(canvas, tx('Zadowolonych klientów', 'Happy customers'), {
      left: cx,
      top: p.height * 0.66,
      width: p.width * 0.8,
      fontSize: p.width * 0.055,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Dziękujemy za zaufanie w 2026 roku', 'Thank you for trusting us in 2026'), {
      left: cx,
      top: p.height * 0.8,
      width: p.width * 0.8,
      fontSize: p.width * 0.032,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });
  },
};

const tipNumbered: DesignTemplate = {
  key: 'tip-numbered',
  category: 'tip',
  label: 'Numbered Tips',
  labelPl: 'Tip Numbered',
  description: 'A list of 3 numbered tips',
  descriptionPl: 'Lista 3 wskazówek z numerami',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addTextbox(canvas, tx('3 wskazówki', '3 tips'), {
      left: p.width * 0.08,
      top: p.height * 0.08,
      width: p.width * 0.85,
      fontSize: p.width * 0.075,
      fill: brand.text,
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: p.width * 0.08,
      top: p.height * 0.2,
      width: p.width * 0.15,
      height: 3,
      fill: brand.primary,
    });

    const tips = [
      tx('Publikuj regularnie', 'Post consistently'),
      tx('Słuchaj odbiorców', 'Listen to your audience'),
      tx('Mierz wyniki', 'Measure your results'),
    ];

    tips.forEach((tip, i) => {
      const top = p.height * (0.32 + i * 0.17);
      addCircle(canvas, {
        left: p.width * 0.08,
        top,
        radius: p.width * 0.035,
        fill: brand.primary,
      });
      addTextbox(canvas, `${i + 1}`, {
        left: p.width * 0.08,
        top: top + p.width * 0.012,
        width: p.width * 0.07,
        fontSize: p.width * 0.032,
        fill: brand.background,
        textAlign: 'center',
        fontWeight: 'bold',
        fontFamily: brand.fontFamily,
      });
      addTextbox(canvas, tip, {
        left: p.width * 0.22,
        top: top + p.width * 0.015,
        width: p.width * 0.7,
        fontSize: p.width * 0.045,
        fill: brand.text,
        fontFamily: brand.fontFamily,
      });
    });
  },
};

const eventDate: DesignTemplate = {
  key: 'event-date',
  category: 'event',
  label: 'Event with Date',
  labelPl: 'Wydarzenie z datą',
  description: 'Date + title + location',
  descriptionPl: 'Data + tytuł + lokalizacja',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: cx,
      top: p.height * 0.12,
      width: p.width * 0.55,
      height: p.height * 0.22,
      fill: 'transparent',
      stroke: brand.primary,
      strokeWidth: 3,
      originX: 'center',
    });

    addTextbox(canvas, '15', {
      left: cx,
      top: p.height * 0.14,
      width: p.width * 0.6,
      fontSize: p.width * 0.18,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addTextbox(canvas, tx('GRUDNIA · 2026', 'DECEMBER · 2026'), {
      left: cx,
      top: p.height * 0.3,
      width: p.width * 0.6,
      fontSize: p.width * 0.03,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      charSpacing: 100,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, 'Webinar:\nMarketing 2027', {
      left: cx,
      top: p.height * 0.45,
      width: p.width * 0.9,
      fontSize: p.width * 0.09,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.1,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('📍 Online · 19:00', '📍 Online · 7 PM'), {
      left: cx,
      top: p.height * 0.72,
      width: p.width * 0.8,
      fontSize: p.width * 0.04,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Zarezerwuj miejsce: postra.pl/event', 'Save your spot: postra.co.uk/event'), {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.8,
      fontSize: p.width * 0.032,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });
  },
};

const communityWelcome: DesignTemplate = {
  key: 'community-welcome',
  category: 'community',
  label: 'Community Welcome',
  labelPl: 'Powitanie społeczności',
  description: 'Welcome new followers',
  descriptionPl: 'Powitanie nowych obserwujących',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '👋', {
      left: cx,
      top: p.height * 0.14,
      width: p.width * 0.5,
      fontSize: p.width * 0.18,
      originX: 'center',
    });

    addTextbox(canvas, tx('Witamy!', 'Welcome!'), {
      left: cx,
      top: p.height * 0.36,
      width: p.width * 0.9,
      fontSize: p.width * 0.15,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Cieszymy się że jesteście\nz nami. Społeczność\nliczy już 1000 osób.', 'So glad to have you\nhere. Our community\nis now 1000 strong.'), {
      left: cx,
      top: p.height * 0.55,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.text,
      originX: 'center',
      lineHeight: 1.4,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('#dziękujemy #społeczność', '#thankyou #community'), {
      left: cx,
      top: p.height * 0.83,
      width: p.width * 0.8,
      fontSize: p.width * 0.035,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const promoBadge: DesignTemplate = {
  key: 'promo-badge',
  category: 'promo',
  label: 'Promo Badge',
  labelPl: 'Promocja z odznaką',
  description: 'Round discount badge with a caption',
  descriptionPl: 'Okrągła odznaka procentowa i tekst opisu',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addCircle(canvas, {
      left: cx,
      top: p.height * 0.32,
      radius: p.width * 0.22,
      fill: brand.primary,
      originX: 'center',
      originY: 'center',
    });

    addTextbox(canvas, '-30%', {
      left: cx,
      top: p.height * 0.32,
      width: p.width * 0.45,
      fontSize: p.width * 0.14,
      fill: brand.background,
      originX: 'center',
      originY: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Tylko w ten weekend', 'This weekend only'), {
      left: cx,
      top: p.height * 0.62,
      width: p.width * 0.85,
      fontSize: p.width * 0.055,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Kod: WEEKEND30', 'Code: WEEKEND30'), {
      left: cx,
      top: p.height * 0.74,
      width: p.width * 0.85,
      fontSize: p.width * 0.04,
      fill: brand.primary,
      originX: 'center',
      charSpacing: 80,
      fontFamily: brand.fontFamily,
    });
  },
};

const quoteMinimal: DesignTemplate = {
  key: 'quote-minimal',
  category: 'quote',
  label: 'Minimal Quote',
  labelPl: 'Cytat Minimalny',
  description: 'Short quote in large type',
  descriptionPl: 'Krótki cytat z dużą typografią',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('Mniej.\nAle lepiej.', 'Less,\nbut better.'), {
      left: cx,
      top: p.height * 0.35,
      width: p.width * 0.9,
      fontSize: p.width * 0.14,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.0,
      textAlign: 'center',
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.72,
      width: p.width * 0.08,
      height: 3,
      fill: brand.primary,
      originX: 'center',
    });

    addTextbox(canvas, '— Dieter Rams', {
      left: cx,
      top: p.height * 0.76,
      width: p.width * 0.7,
      fontSize: p.width * 0.03,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const announcementBanner: DesignTemplate = {
  key: 'announcement-banner',
  category: 'announcement',
  label: 'Announcement Banner',
  labelPl: 'Ogłoszenie Banner',
  description: 'Badge strip + big title',
  descriptionPl: 'Pasek odznaki + duży tytuł',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: cx,
      top: p.height * 0.12,
      width: p.width * 0.35,
      height: p.height * 0.05,
      fill: brand.primary,
      rx: p.height * 0.025,
      ry: p.height * 0.025,
      originX: 'center',
    });

    addTextbox(canvas, tx('WAŻNE', 'BIG NEWS'), {
      left: cx,
      top: p.height * 0.13,
      width: p.width * 0.35,
      fontSize: p.width * 0.028,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Mamy świetne\nwiadomości', 'We have some\ngreat news'), {
      left: cx,
      top: p.height * 0.32,
      width: p.width * 0.9,
      fontSize: p.width * 0.11,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.1,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Sprawdź szczegóły w komentarzu poniżej.', 'Check the comments below for details.'), {
      left: cx,
      top: p.height * 0.7,
      width: p.width * 0.85,
      fontSize: p.width * 0.04,
      fill: brand.text,
      originX: 'center',
      opacity: 0.75,
      fontFamily: brand.fontFamily,
    });
  },
};

const statsComparison: DesignTemplate = {
  key: 'stats-comparison',
  category: 'stats',
  label: 'Stats Comparison',
  labelPl: 'Statystyki Porównanie',
  description: 'Two numbers side by side',
  descriptionPl: 'Dwie liczby vs siebie',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addTextbox(canvas, tx('PRZED', 'BEFORE'), {
      left: p.width * 0.25,
      top: p.height * 0.2,
      width: p.width * 0.4,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '23%', {
      left: p.width * 0.25,
      top: p.height * 0.35,
      width: p.width * 0.4,
      fontSize: p.width * 0.18,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('PO', 'AFTER'), {
      left: p.width * 0.75,
      top: p.height * 0.2,
      width: p.width * 0.4,
      fontSize: p.width * 0.035,
      fill: brand.primary,
      originX: 'center',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '87%', {
      left: p.width * 0.75,
      top: p.height * 0.35,
      width: p.width * 0.4,
      fontSize: p.width * 0.18,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Skuteczność po wdrożeniu', 'Results after the change'), {
      left: p.width / 2,
      top: p.height * 0.72,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Case study klienta — sprawdź w komentarzu', 'Client case study — see the comments'), {
      left: p.width / 2,
      top: p.height * 0.82,
      width: p.width * 0.85,
      fontSize: p.width * 0.03,
      fill: brand.text,
      originX: 'center',
      opacity: 0.6,
      fontFamily: brand.fontFamily,
    });
  },
};

const tipDidYouKnow: DesignTemplate = {
  key: 'tip-didyouknow',
  category: 'tip',
  label: 'Tip — Did You Know',
  labelPl: 'Tip — Czy wiesz',
  description: 'A single fact or tip',
  descriptionPl: 'Pojedynczy fakt / wskazówka',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '💡', {
      left: cx,
      top: p.height * 0.14,
      width: p.width * 0.3,
      fontSize: p.width * 0.14,
      originX: 'center',
    });

    addTextbox(canvas, tx('Czy wiesz, że...', 'Did you know...'), {
      left: cx,
      top: p.height * 0.34,
      width: p.width * 0.85,
      fontSize: p.width * 0.04,
      fill: brand.primary,
      originX: 'center',
      charSpacing: 100,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Posty z grafiką mają\n2.3× większy zasięg\nniż same teksty?', 'Posts with images get\n2.3× more reach\nthan text alone?'), {
      left: cx,
      top: p.height * 0.45,
      width: p.width * 0.85,
      fontSize: p.width * 0.065,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.3,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Źródło: HubSpot 2026', 'Source: HubSpot 2026'), {
      left: cx,
      top: p.height * 0.84,
      width: p.width * 0.8,
      fontSize: p.width * 0.028,
      fill: brand.text,
      originX: 'center',
      opacity: 0.5,
      fontFamily: brand.fontFamily,
    });
  },
};

const eventSaveDate: DesignTemplate = {
  key: 'event-save-date',
  category: 'event',
  label: 'Save the Date',
  labelPl: 'Save the Date',
  description: 'Minimal save-the-date',
  descriptionPl: 'Minimalistyczne zapisz datę',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, 'SAVE\nTHE\nDATE', {
      left: cx,
      top: p.height * 0.2,
      width: p.width * 0.9,
      fontSize: p.width * 0.16,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      lineHeight: 0.95,
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.62,
      width: p.width * 0.5,
      height: 2,
      fill: brand.primary,
      originX: 'center',
    });

    addTextbox(canvas, '07.06.2026', {
      left: cx,
      top: p.height * 0.66,
      width: p.width * 0.85,
      fontSize: p.width * 0.07,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Konferencja Marketing PL · Warszawa', 'Marketing Conference UK · London'), {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.85,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });
  },
};

const communityThanks: DesignTemplate = {
  key: 'community-thanks',
  category: 'community',
  label: 'Thank You',
  labelPl: 'Podziękowanie',
  description: 'Big thank-you with follower count',
  descriptionPl: 'Duże dziękujemy z liczbą obserwujących',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('5 000', '5,000'), {
      left: cx,
      top: p.height * 0.22,
      width: p.width * 0.9,
      fontSize: p.width * 0.26,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('obserwujących', 'followers'), {
      left: cx,
      top: p.height * 0.52,
      width: p.width * 0.9,
      fontSize: p.width * 0.05,
      fill: brand.text,
      originX: 'center',
      opacity: 0.8,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.62,
      width: p.width * 0.2,
      height: 2,
      fill: brand.primary,
      originX: 'center',
    });

    addTextbox(canvas, tx('Dziękujemy ❤️', 'Thank you ❤️'), {
      left: cx,
      top: p.height * 0.68,
      width: p.width * 0.85,
      fontSize: p.width * 0.085,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Idziemy po więcej razem 🚀', 'On to the next milestone 🚀'), {
      left: cx,
      top: p.height * 0.84,
      width: p.width * 0.85,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.6,
      fontFamily: brand.fontFamily,
    });
  },
};

const reelCoverHook: DesignTemplate = {
  key: 'reel-cover-hook',
  category: 'reel-cover',
  label: 'Cover: How-to Hook',
  labelPl: 'Cover: Hak (How-to)',
  description: 'Big headline with a seconds count — best for tutorials',
  descriptionPl: 'Duży nagłówek z liczbą sekund — najlepszy do tutoriali',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: 0,
      top: 0,
      width: p.width,
      height: p.height,
      fill: new fabric.Gradient({
        type: 'linear',
        coords: { x1: 0, y1: 0, x2: 0, y2: p.height },
        colorStops: [
          { offset: 0, color: brand.background },
          { offset: 1, color: brand.primary },
        ],
      }),
      selectable: false,
      evented: false,
    });

    addTextbox(canvas, tx('JAK ZROBIĆ', 'HOW TO DO'), {
      left: cx,
      top: p.height * 0.18,
      width: p.width * 0.8,
      fontSize: p.width * 0.085,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: '600',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('X w 60s', 'X in 60s'), {
      left: cx,
      top: p.height * 0.32,
      width: p.width * 0.95,
      fontSize: p.width * 0.22,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '👇', {
      left: cx,
      top: p.height * 0.78,
      width: p.width * 0.3,
      fontSize: p.width * 0.18,
      originX: 'center',
      textAlign: 'center',
    });
  },
};

const reelCoverReveal: DesignTemplate = {
  key: 'reel-cover-reveal',
  category: 'reel-cover',
  label: "Cover: You Won't Believe",
  labelPl: 'Cover: Zaskoczyło mnie',
  description: 'Bold text with emoji — high-CTR pattern',
  descriptionPl: 'Bold tekst z emoji — high-CTR pattern',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: cx,
      top: p.height * 0.05,
      width: p.width * 0.7,
      height: p.height * 0.06,
      fill: brand.primary,
      originX: 'center',
      rx: p.height * 0.03,
      ry: p.height * 0.03,
    });
    addTextbox(canvas, tx('NIE UWIERZYSZ', "YOU WON'T BELIEVE"), {
      left: cx,
      top: p.height * 0.06,
      width: p.width * 0.7,
      fontSize: p.width * 0.04,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 150,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Co się\nstało gdy\nspróbowałem\ntego?', 'What\nhappened\nwhen I tried\nthis?'), {
      left: cx,
      top: p.height * 0.25,
      width: p.width * 0.92,
      fontSize: p.width * 0.13,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      lineHeight: 1.05,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '🤯', {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.3,
      fontSize: p.width * 0.18,
      originX: 'center',
      textAlign: 'center',
    });
  },
};

const reelCoverList: DesignTemplate = {
  key: 'reel-cover-list',
  category: 'reel-cover',
  label: 'Cover: List (5 Tips)',
  labelPl: 'Cover: Lista (5 tipów)',
  description: 'Number + topic — easy to scan in the feed',
  descriptionPl: 'Numer + temat — szybko czytelne w feedzie',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addCircle(canvas, {
      left: cx,
      top: p.height * 0.18,
      radius: p.width * 0.12,
      fill: brand.primary,
      originX: 'center',
      originY: 'center',
    });
    addTextbox(canvas, '5', {
      left: cx,
      top: p.height * 0.13,
      width: p.width * 0.3,
      fontSize: p.width * 0.18,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('TIPÓW', 'TIPS'), {
      left: cx,
      top: p.height * 0.38,
      width: p.width * 0.8,
      fontSize: p.width * 0.06,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: '600',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
      opacity: 0.8,
    });

    addTextbox(canvas, tx('Na produktywność\npracy zdalnej', 'For remote work\nproductivity'), {
      left: cx,
      top: p.height * 0.5,
      width: p.width * 0.92,
      fontSize: p.width * 0.1,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      lineHeight: 1.1,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.55,
      height: p.height * 0.06,
      fill: brand.primary,
      rx: p.height * 0.03,
      ry: p.height * 0.03,
      originX: 'center',
    });
    addTextbox(canvas, tx('PRZESUŃ →', 'SWIPE →'), {
      left: cx,
      top: p.height * 0.835,
      width: p.width * 0.55,
      fontSize: p.width * 0.035,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 150,
      fontFamily: brand.fontFamily,
    });
  },
};

const promoFlashSale: DesignTemplate = {
  key: 'promo-flash-sale',
  category: 'promo',
  label: 'Flash Sale',
  labelPl: 'Flash Sale',
  description: 'Urgency bar + big flash sale headline with deadline',
  descriptionPl: 'Pasek pilności + duży nagłówek flash sale z terminem',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addRect(canvas, {
      left: 0,
      top: 0,
      width: p.width,
      height: p.height * 0.09,
      fill: brand.primary,
      selectable: false,
    });

    addTextbox(canvas, tx('⏰ KOŃCZY SIĘ WKRÓTCE', '⏰ ENDS SOON'), {
      left: p.width / 2,
      top: p.height * 0.028,
      width: p.width * 0.9,
      fontSize: p.width * 0.032,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 150,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, 'FLASH\nSALE', {
      left: p.width * 0.08,
      top: p.height * 0.2,
      width: p.width * 0.85,
      fontSize: p.width * 0.19,
      fill: brand.text,
      textAlign: 'left',
      lineHeight: 0.95,
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addTextbox(canvas, '-30%', {
      left: p.width * 0.08,
      top: p.height * 0.58,
      width: p.width * 0.85,
      fontSize: p.width * 0.12,
      fill: brand.primary,
      textAlign: 'left',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: p.width * 0.08,
      top: p.height * 0.76,
      width: p.width * 0.18,
      height: 3,
      fill: brand.primary,
    });

    addTextbox(canvas, tx('Tylko do niedzieli', 'Ends Sunday'), {
      left: p.width * 0.08,
      top: p.height * 0.8,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.text,
      textAlign: 'left',
      opacity: 0.85,
      fontFamily: brand.fontFamily,
    });
  },
};

const promoPriceDrop: DesignTemplate = {
  key: 'promo-price-drop',
  category: 'promo',
  label: 'Price Drop',
  labelPl: 'Obniżka ceny',
  description: 'Old price struck through, new price huge',
  descriptionPl: 'Stara cena przekreślona, nowa cena bardzo duża',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('NIŻSZA CENA', 'PRICE DROP'), {
      left: cx,
      top: p.height * 0.08,
      width: p.width * 0.85,
      fontSize: p.width * 0.04,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '199', {
      left: cx,
      top: p.height * 0.2,
      width: p.width * 0.5,
      fontSize: p.width * 0.09,
      fill: brand.text,
      originX: 'center',
      opacity: 0.5,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.2 + p.width * 0.05,
      width: p.width * 0.24,
      height: p.width * 0.012,
      fill: brand.primary,
      originX: 'center',
      angle: -6,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.36,
      width: p.width * 0.26,
      height: p.height * 0.055,
      fill: brand.primary,
      rx: p.height * 0.0275,
      ry: p.height * 0.0275,
      originX: 'center',
    });

    addTextbox(canvas, tx('TERAZ', 'NOW'), {
      left: cx,
      top: p.height * 0.372,
      width: p.width * 0.26,
      fontSize: p.width * 0.03,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '99', {
      left: cx,
      top: p.height * 0.44,
      width: p.width * 0.9,
      fontSize: p.width * 0.3,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Do wyczerpania zapasów', 'While stocks last'), {
      left: cx,
      top: p.height * 0.84,
      width: p.width * 0.85,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.6,
      fontFamily: brand.fontFamily,
    });
  },
};

const promoGiveaway: DesignTemplate = {
  key: 'promo-giveaway',
  category: 'promo',
  label: 'Giveaway',
  labelPl: 'Konkurs',
  description: 'Giveaway header with 3 steps to enter',
  descriptionPl: 'Nagłówek konkursu z 3 krokami udziału',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '🎁', {
      left: cx,
      top: p.height * 0.05,
      width: p.width * 0.3,
      fontSize: p.width * 0.1,
      originX: 'center',
    });

    addTextbox(canvas, tx('KONKURS', 'GIVEAWAY'), {
      left: cx,
      top: p.height * 0.17,
      width: p.width * 0.9,
      fontSize: p.width * 0.12,
      fill: brand.primary,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    const steps = [
      tx('Obserwuj nasz profil', 'Follow our page'),
      tx('Polub ten post', 'Like this post'),
      tx('Oznacz znajomego', 'Tag a friend'),
    ];

    steps.forEach((step, i) => {
      const top = p.height * (0.36 + i * 0.14);
      addRect(canvas, {
        left: p.width * 0.1,
        top,
        width: p.width * 0.08,
        height: p.width * 0.08,
        fill: brand.primary,
        rx: p.width * 0.015,
        ry: p.width * 0.015,
      });
      addTextbox(canvas, `${i + 1}`, {
        left: p.width * 0.1,
        top: top + p.width * 0.018,
        width: p.width * 0.08,
        fontSize: p.width * 0.04,
        fill: brand.background,
        textAlign: 'center',
        fontWeight: 'bold',
        fontFamily: brand.fontFamily,
      });
      addTextbox(canvas, step, {
        left: p.width * 0.24,
        top: top + p.width * 0.018,
        width: p.width * 0.68,
        fontSize: p.width * 0.045,
        fill: brand.text,
        textAlign: 'left',
        fontFamily: brand.fontFamily,
      });
    });

    addTextbox(canvas, tx('Wyniki ogłosimy w piątek!', 'Winner announced on Friday!'), {
      left: cx,
      top: p.height * 0.85,
      width: p.width * 0.85,
      fontSize: p.width * 0.032,
      fill: brand.text,
      originX: 'center',
      opacity: 0.6,
      fontFamily: brand.fontFamily,
    });
  },
};

const quoteReview: DesignTemplate = {
  key: 'quote-review',
  category: 'quote',
  label: 'Customer Review',
  labelPl: 'Opinia klienta',
  description: '5 stars, review and customer name',
  descriptionPl: '5 gwiazdek, opinia i imię klienta',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '★★★★★', {
      left: cx,
      top: p.height * 0.16,
      width: p.width * 0.8,
      fontSize: p.width * 0.085,
      fill: brand.primary,
      originX: 'center',
      charSpacing: 100,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Najlepsza obsługa, z jaką\nmiałam do czynienia.\nPolecam każdemu!', 'The best service I have\never experienced.\nHighly recommend!'), {
      left: cx,
      top: p.height * 0.34,
      width: p.width * 0.85,
      fontSize: p.width * 0.055,
      fill: brand.text,
      originX: 'center',
      fontStyle: 'italic',
      lineHeight: 1.35,
      fontFamily: '"Playfair Display", Georgia, serif',
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.7,
      width: p.width * 0.12,
      height: 2,
      fill: brand.primary,
      originX: 'center',
    });

    addTextbox(canvas, tx('— Anna K.', '— Sarah M.'), {
      left: cx,
      top: p.height * 0.74,
      width: p.width * 0.7,
      fontSize: p.width * 0.04,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('✓ zweryfikowany klient', '✓ verified customer'), {
      left: cx,
      top: p.height * 0.81,
      width: p.width * 0.7,
      fontSize: p.width * 0.028,
      fill: brand.primary,
      originX: 'center',
      opacity: 0.8,
      fontFamily: brand.fontFamily,
    });
  },
};

const announcementHiring: DesignTemplate = {
  key: 'announcement-hiring',
  category: 'announcement',
  label: "We're Hiring",
  labelPl: 'Zatrudniamy',
  description: 'Job opening with role and apply CTA',
  descriptionPl: 'Oferta pracy ze stanowiskiem i CTA aplikuj',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addRect(canvas, {
      left: p.width * 0.08,
      top: p.height * 0.1,
      width: p.width * 0.012,
      height: p.height * 0.26,
      fill: brand.primary,
    });

    addTextbox(canvas, tx('DOŁĄCZ DO NAS', 'JOIN OUR TEAM'), {
      left: p.width * 0.13,
      top: p.height * 0.11,
      width: p.width * 0.8,
      fontSize: p.width * 0.035,
      fill: brand.primary,
      textAlign: 'left',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('ZATRUDNIAMY', "WE'RE\nHIRING"), {
      left: p.width * 0.13,
      top: p.height * 0.18,
      width: p.width * 0.85,
      fontSize: p.width * 0.135,
      fill: brand.text,
      textAlign: 'left',
      lineHeight: 1.0,
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addRect(canvas, {
      left: p.width * 0.08,
      top: p.height * 0.52,
      width: p.width * 0.84,
      height: p.height * 0.12,
      fill: 'transparent',
      stroke: brand.primary,
      strokeWidth: 2,
      rx: p.width * 0.02,
      ry: p.width * 0.02,
    });

    addTextbox(canvas, tx('Specjalista ds. social media', 'Social Media Specialist'), {
      left: p.width / 2,
      top: p.height * 0.555,
      width: p.width * 0.78,
      fontSize: p.width * 0.05,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Pełny etat · praca hybrydowa', 'Full-time · hybrid'), {
      left: p.width / 2,
      top: p.height * 0.7,
      width: p.width * 0.8,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Aplikuj: twojastrona.pl/kariera', 'Apply: yoursite.com/jobs'), {
      left: p.width / 2,
      top: p.height * 0.82,
      width: p.width * 0.85,
      fontSize: p.width * 0.04,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });
  },
};

const announcementHours: DesignTemplate = {
  key: 'announcement-hours',
  category: 'announcement',
  label: 'Opening Hours',
  labelPl: 'Godziny otwarcia',
  description: 'Business hours card with weekday rows',
  descriptionPl: 'Karta godzin otwarcia z wierszami dni tygodnia',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, '🕐', {
      left: cx,
      top: p.height * 0.06,
      width: p.width * 0.3,
      fontSize: p.width * 0.09,
      originX: 'center',
    });

    addTextbox(canvas, tx('Godziny otwarcia', 'Opening hours'), {
      left: cx,
      top: p.height * 0.17,
      width: p.width * 0.9,
      fontSize: p.width * 0.08,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.3,
      width: p.width * 0.84,
      height: p.height * 0.42,
      fill: 'transparent',
      stroke: brand.primary,
      strokeWidth: 2,
      rx: p.width * 0.025,
      ry: p.width * 0.025,
      originX: 'center',
    });

    const rows: [string, string][] = [
      [tx('Pn–Pt', 'Mon–Fri'), '9:00–17:00'],
      [tx('Sob', 'Sat'), '10:00–14:00'],
      [tx('Nd', 'Sun'), tx('zamknięte', 'closed')],
    ];

    rows.forEach(([day, time], i) => {
      const top = p.height * (0.355 + i * 0.12);
      addTextbox(canvas, day, {
        left: p.width * 0.15,
        top,
        width: p.width * 0.33,
        fontSize: p.width * 0.042,
        fill: brand.primary,
        textAlign: 'left',
        fontWeight: 'bold',
        fontFamily: brand.fontFamily,
      });
      addTextbox(canvas, time, {
        left: p.width * 0.5,
        top,
        width: p.width * 0.35,
        fontSize: p.width * 0.042,
        fill: brand.text,
        textAlign: 'right',
        fontFamily: brand.fontFamily,
      });
      if (i < rows.length - 1) {
        addRect(canvas, {
          left: cx,
          top: top + p.height * 0.085,
          width: p.width * 0.7,
          height: 1,
          fill: brand.text,
          opacity: 0.2,
          originX: 'center',
        });
      }
    });

    addTextbox(canvas, tx('Zapraszamy!', 'See you soon!'), {
      left: cx,
      top: p.height * 0.8,
      width: p.width * 0.8,
      fontSize: p.width * 0.04,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });
  },
};

const announcementClosure: DesignTemplate = {
  key: 'announcement-closure',
  category: 'announcement',
  label: 'Holiday Closure',
  labelPl: 'Przerwa świąteczna',
  description: 'Closed dates with a see-you-soon note',
  descriptionPl: 'Daty zamknięcia z notką do zobaczenia',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('PRZERWA ŚWIĄTECZNA', 'HOLIDAY CLOSURE'), {
      left: cx,
      top: p.height * 0.1,
      width: p.width * 0.9,
      fontSize: p.width * 0.034,
      fill: brand.primary,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Zamknięte', "We're\nclosed"), {
      left: cx,
      top: p.height * 0.22,
      width: p.width * 0.9,
      fontSize: p.width * 0.15,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      lineHeight: 1.0,
      fontFamily: '"Bebas Neue", Impact, sans-serif',
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.55,
      width: p.width * 0.6,
      height: p.height * 0.1,
      fill: 'transparent',
      stroke: brand.primary,
      strokeWidth: 3,
      rx: p.width * 0.02,
      ry: p.width * 0.02,
      originX: 'center',
    });

    addTextbox(canvas, tx('24–26 grudnia', '24–26 December'), {
      left: cx,
      top: p.height * 0.582,
      width: p.width * 0.55,
      fontSize: p.width * 0.05,
      fill: brand.primary,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Do zobaczenia 27 grudnia! 👋', 'See you on 27 December! 👋'), {
      left: cx,
      top: p.height * 0.76,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.text,
      originX: 'center',
      opacity: 0.85,
      fontFamily: brand.fontFamily,
    });
  },
};

const statsMilestone: DesignTemplate = {
  key: 'stats-milestone',
  category: 'stats',
  label: 'Milestone',
  labelPl: 'Kamień milowy',
  description: 'Big follower number with confetti dots',
  descriptionPl: 'Duża liczba obserwujących z konfetti',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    const confetti: [number, number, number][] = [
      [0.12, 0.08, 0.012],
      [0.28, 0.16, 0.008],
      [0.5, 0.06, 0.01],
      [0.72, 0.14, 0.008],
      [0.88, 0.09, 0.012],
      [0.18, 0.88, 0.01],
      [0.45, 0.93, 0.008],
      [0.7, 0.9, 0.012],
      [0.9, 0.84, 0.008],
    ];
    confetti.forEach(([x, y, r], i) => {
      addCircle(canvas, {
        left: p.width * x,
        top: p.height * y,
        radius: p.width * r,
        fill: i % 2 === 0 ? brand.primary : brand.text,
        opacity: i % 2 === 0 ? 0.9 : 0.5,
        selectable: false,
      });
    });

    addTextbox(canvas, tx('10 000', '10,000'), {
      left: cx,
      top: p.height * 0.28,
      width: p.width * 0.95,
      fontSize: p.width * 0.22,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('obserwujących — dziękujemy!', 'followers — thank you!'), {
      left: cx,
      top: p.height * 0.56,
      width: p.width * 0.85,
      fontSize: p.width * 0.05,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('To dopiero początek 🎉', 'And this is just the beginning 🎉'), {
      left: cx,
      top: p.height * 0.7,
      width: p.width * 0.8,
      fontSize: p.width * 0.035,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });
  },
};

const tipDoDont: DesignTemplate = {
  key: 'tip-dodont',
  category: 'tip',
  label: "Do & Don't",
  labelPl: 'Rób i nie rób',
  description: 'Two-column do vs don’t comparison',
  descriptionPl: 'Dwie kolumny: rób vs unikaj',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addRect(canvas, {
      left: 0,
      top: 0,
      width: p.width / 2,
      height: p.height,
      fill: brand.primary,
      opacity: 0.16,
      selectable: false,
      evented: false,
    });

    addRect(canvas, {
      left: p.width / 2,
      top: 0,
      width: p.width / 2,
      height: p.height,
      fill: brand.text,
      opacity: 0.05,
      selectable: false,
      evented: false,
    });

    addRect(canvas, {
      left: p.width / 2,
      top: 0,
      width: 2,
      height: p.height,
      fill: brand.text,
      opacity: 0.25,
      selectable: false,
      evented: false,
    });

    addTextbox(canvas, tx('✅ RÓB', '✅ DO'), {
      left: p.width * 0.25,
      top: p.height * 0.12,
      width: p.width * 0.42,
      fontSize: p.width * 0.05,
      fill: brand.primary,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 100,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('❌ UNIKAJ', "❌ DON'T"), {
      left: p.width * 0.75,
      top: p.height * 0.12,
      width: p.width * 0.42,
      fontSize: p.width * 0.05,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      charSpacing: 100,
      fontFamily: brand.fontFamily,
    });

    const doItems = [
      tx('Planuj posty\nz wyprzedzeniem', 'Plan posts\nahead of time'),
      tx('Odpowiadaj na\nkomentarze', 'Reply to\ncomments'),
    ];
    const dontItems = [
      tx('Kupuj\nobserwujących', 'Buy\nfollowers'),
      tx('Ignoruj\nwiadomości', 'Ignore\nyour DMs'),
    ];

    doItems.forEach((item, i) => {
      addTextbox(canvas, item, {
        left: p.width * 0.25,
        top: p.height * (0.32 + i * 0.22),
        width: p.width * 0.4,
        fontSize: p.width * 0.04,
        fill: brand.text,
        originX: 'center',
        textAlign: 'center',
        lineHeight: 1.25,
        fontFamily: brand.fontFamily,
      });
    });
    dontItems.forEach((item, i) => {
      addTextbox(canvas, item, {
        left: p.width * 0.75,
        top: p.height * (0.32 + i * 0.22),
        width: p.width * 0.4,
        fontSize: p.width * 0.04,
        fill: brand.text,
        originX: 'center',
        textAlign: 'center',
        lineHeight: 1.25,
        opacity: 0.75,
        fontFamily: brand.fontFamily,
      });
    });

    addTextbox(canvas, tx('Social media w praktyce', 'Social media done right'), {
      left: p.width / 2,
      top: p.height * 0.86,
      width: p.width * 0.85,
      fontSize: p.width * 0.032,
      fill: brand.text,
      originX: 'center',
      textAlign: 'center',
      opacity: 0.6,
      fontFamily: brand.fontFamily,
    });
  },
};

const eventLive: DesignTemplate = {
  key: 'event-live',
  category: 'event',
  label: 'Live / Webinar',
  labelPl: 'Live / Webinar',
  description: 'LIVE badge, title, date and reminder CTA',
  descriptionPl: 'Odznaka LIVE, tytuł, data i CTA przypomnienia',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: p.width * 0.08,
      top: p.height * 0.08,
      width: p.width * 0.28,
      height: p.height * 0.06,
      fill: 'transparent',
      stroke: '#ef4444',
      strokeWidth: 2,
      rx: p.height * 0.03,
      ry: p.height * 0.03,
    });

    addCircle(canvas, {
      left: p.width * 0.12,
      top: p.height * 0.08 + p.height * 0.03 - p.width * 0.012,
      radius: p.width * 0.012,
      fill: '#ef4444',
    });

    addTextbox(canvas, 'LIVE', {
      left: p.width * 0.17,
      top: p.height * 0.08 + p.height * 0.03 - p.width * 0.018,
      width: p.width * 0.16,
      fontSize: p.width * 0.032,
      fill: '#ef4444',
      textAlign: 'left',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Q&A na żywo\nz naszym\nzespołem', 'Live Q&A\nwith our\nteam'), {
      left: p.width * 0.08,
      top: p.height * 0.24,
      width: p.width * 0.85,
      fontSize: p.width * 0.1,
      fill: brand.text,
      textAlign: 'left',
      fontWeight: 'bold',
      lineHeight: 1.1,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('📅 Czwartek · 18:00', '📅 Thursday · 6 PM'), {
      left: p.width * 0.08,
      top: p.height * 0.66,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.primary,
      textAlign: 'left',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.8,
      width: p.width * 0.6,
      height: p.height * 0.08,
      fill: brand.primary,
      rx: p.height * 0.04,
      ry: p.height * 0.04,
      originX: 'center',
    });

    addTextbox(canvas, tx('Ustaw przypomnienie 🔔', 'Set a reminder 🔔'), {
      left: cx,
      top: p.height * 0.823,
      width: p.width * 0.6,
      fontSize: p.width * 0.035,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });
  },
};

const communityQuestion: DesignTemplate = {
  key: 'community-question',
  category: 'community',
  label: 'Question Post',
  labelPl: 'Post z pytaniem',
  description: 'Engaging question with comment CTA',
  descriptionPl: 'Angażujące pytanie z CTA do komentarzy',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addTextbox(canvas, 'Q:', {
      left: p.width * 0.08,
      top: p.height * 0.08,
      width: p.width * 0.5,
      fontSize: p.width * 0.22,
      fill: brand.primary,
      textAlign: 'left',
      fontWeight: 'bold',
      fontFamily: '"Playfair Display", Georgia, serif',
    });

    addTextbox(canvas, tx('Jaki jest Twój\nulubiony produkt\nz naszej oferty?', "What's your\nfavourite product\nfrom our range?"), {
      left: p.width * 0.08,
      top: p.height * 0.38,
      width: p.width * 0.85,
      fontSize: p.width * 0.07,
      fill: brand.text,
      textAlign: 'left',
      fontWeight: 'bold',
      lineHeight: 1.25,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: p.width * 0.08,
      top: p.height * 0.76,
      width: p.width * 0.15,
      height: 3,
      fill: brand.primary,
    });

    addTextbox(canvas, tx('Napisz w komentarzu 👇', 'Comment below 👇'), {
      left: p.width * 0.08,
      top: p.height * 0.81,
      width: p.width * 0.85,
      fontSize: p.width * 0.045,
      fill: brand.primary,
      textAlign: 'left',
      fontFamily: brand.fontFamily,
    });
  },
};

const communityFollow: DesignTemplate = {
  key: 'community-follow',
  category: 'community',
  label: 'Follow Us',
  labelPl: 'Obserwuj nas',
  description: 'Handle, platforms and follow CTA',
  descriptionPl: 'Nazwa profilu, platformy i CTA obserwuj',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addCircle(canvas, {
      left: cx,
      top: p.height * 0.2,
      radius: p.width * 0.11,
      fill: brand.primary,
      originX: 'center',
      originY: 'center',
    });

    addTextbox(canvas, '@', {
      left: cx,
      top: p.height * 0.2,
      width: p.width * 0.25,
      fontSize: p.width * 0.12,
      fill: brand.background,
      originX: 'center',
      originY: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '@yourbrand', {
      left: cx,
      top: p.height * 0.38,
      width: p.width * 0.9,
      fontSize: p.width * 0.09,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, 'Instagram · Facebook · TikTok', {
      left: cx,
      top: p.height * 0.52,
      width: p.width * 0.85,
      fontSize: p.width * 0.038,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      charSpacing: 60,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.68,
      width: p.width * 0.55,
      height: p.height * 0.08,
      fill: brand.primary,
      rx: p.height * 0.04,
      ry: p.height * 0.04,
      originX: 'center',
    });

    addTextbox(canvas, tx('Obserwuj po więcej', 'Follow for more'), {
      left: cx,
      top: p.height * 0.703,
      width: p.width * 0.55,
      fontSize: p.width * 0.038,
      fill: brand.background,
      originX: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Codziennie nowe treści ✨', 'New content every day ✨'), {
      left: cx,
      top: p.height * 0.85,
      width: p.width * 0.8,
      fontSize: p.width * 0.032,
      fill: brand.text,
      originX: 'center',
      opacity: 0.6,
      fontFamily: brand.fontFamily,
    });
  },
};

const reelCoverBeforeAfter: DesignTemplate = {
  key: 'reel-cover-beforeafter',
  category: 'reel-cover',
  label: 'Cover: Before / After',
  labelPl: 'Cover: Przed / Po',
  description: 'Split background with before and after labels',
  descriptionPl: 'Tło podzielone na pół z etykietami przed i po',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: 0,
      top: 0,
      width: p.width,
      height: p.height / 2,
      fill: brand.background,
      selectable: false,
      evented: false,
    });

    addRect(canvas, {
      left: 0,
      top: p.height / 2,
      width: p.width,
      height: p.height / 2,
      fill: brand.primary,
      selectable: false,
      evented: false,
    });

    addTextbox(canvas, tx('PRZED', 'BEFORE'), {
      left: p.width * 0.08,
      top: p.height * 0.08,
      width: p.width * 0.5,
      fontSize: p.width * 0.06,
      fill: brand.text,
      textAlign: 'left',
      fontWeight: 'bold',
      charSpacing: 250,
      opacity: 0.85,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('PO', 'AFTER'), {
      left: p.width * 0.42,
      top: p.height * 0.85,
      width: p.width * 0.5,
      fontSize: p.width * 0.06,
      fill: brand.background,
      textAlign: 'right',
      fontWeight: 'bold',
      charSpacing: 250,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.5,
      width: p.width * 0.76,
      height: p.height * 0.14,
      fill: brand.background,
      stroke: brand.text,
      strokeWidth: 2,
      rx: p.width * 0.02,
      ry: p.width * 0.02,
      originX: 'center',
      originY: 'center',
    });

    addTextbox(canvas, tx('ZOBACZ\nRÓŻNICĘ', 'SEE THE\nDIFFERENCE'), {
      left: cx,
      top: p.height * 0.5,
      width: p.width * 0.7,
      fontSize: p.width * 0.055,
      fill: brand.text,
      originX: 'center',
      originY: 'center',
      textAlign: 'center',
      fontWeight: 'bold',
      lineHeight: 1.1,
      fontFamily: brand.fontFamily,
    });
  },
};

const quoteStatement: DesignTemplate = {
  key: 'quote-statement',
  category: 'quote',
  label: 'Bold Statement',
  labelPl: 'Mocne stwierdzenie',
  description: 'Big left-aligned statement on an accent block',
  descriptionPl: 'Duże stwierdzenie na akcentowym bloku',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);

    addRect(canvas, {
      left: 0,
      top: p.height * 0.3,
      width: p.width * 0.06,
      height: p.height * 0.32,
      fill: brand.primary,
      selectable: false,
    });

    addTextbox(canvas, tx('Dobry content\nto rozmowa,\nnie megafon.', 'Great content\nis a conversation,\nnot a megaphone.'), {
      left: p.width * 0.12,
      top: p.height * 0.3,
      width: p.width * 0.8,
      fontSize: p.width * 0.075,
      fill: brand.text,
      textAlign: 'left',
      fontWeight: 'bold',
      lineHeight: 1.25,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, '@postra', {
      left: p.width * 0.12,
      top: p.height * 0.72,
      width: p.width * 0.6,
      fontSize: p.width * 0.032,
      fill: brand.primary,
      textAlign: 'left',
      fontFamily: brand.fontFamily,
    });
  },
};

const quoteMantra: DesignTemplate = {
  key: 'quote-mantra',
  category: 'quote',
  label: 'Monday Mantra',
  labelPl: 'Mantra na poniedziałek',
  description: 'Short centred phrase between divider lines',
  descriptionPl: 'Krótka fraza między liniami',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('MANTRA NA DZIŚ', "TODAY'S MANTRA"), {
      left: cx,
      top: p.height * 0.18,
      width: p.width * 0.8,
      fontSize: p.width * 0.032,
      fill: brand.primary,
      originX: 'center',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.3,
      width: p.width * 0.22,
      height: 3,
      fill: brand.primary,
      originX: 'center',
      selectable: false,
    });

    addTextbox(canvas, tx('Zrobione jest lepsze\nniż perfekcyjne.', 'Done is better\nthan perfect.'), {
      left: cx,
      top: p.height * 0.4,
      width: p.width * 0.85,
      fontSize: p.width * 0.08,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.25,
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.66,
      width: p.width * 0.22,
      height: 3,
      fill: brand.primary,
      originX: 'center',
      selectable: false,
    });

    addTextbox(canvas, tx('Udostępnij komuś, kto tego potrzebuje', 'Share this with someone who needs it'), {
      left: cx,
      top: p.height * 0.84,
      width: p.width * 0.8,
      fontSize: p.width * 0.028,
      fill: brand.text,
      originX: 'center',
      opacity: 0.5,
      fontFamily: brand.fontFamily,
    });
  },
};

const statsBigNumber: DesignTemplate = {
  key: 'stats-big-number',
  category: 'stats',
  label: 'Big Number',
  labelPl: 'Wielka liczba',
  description: 'One huge metric with context',
  descriptionPl: 'Jedna wielka metryka z kontekstem',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('W TYM MIESIĄCU', 'THIS MONTH'), {
      left: cx,
      top: p.height * 0.16,
      width: p.width * 0.8,
      fontSize: p.width * 0.034,
      fill: brand.text,
      originX: 'center',
      charSpacing: 180,
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });

    addCircle(canvas, {
      left: cx,
      top: p.height * 0.44,
      radius: p.width * 0.24,
      fill: brand.primary,
      opacity: 0.15,
      originX: 'center',
      originY: 'center',
      selectable: false,
    });

    addTextbox(canvas, '+248%', {
      left: cx,
      top: p.height * 0.35,
      width: p.width * 0.9,
      fontSize: p.width * 0.19,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('wzrostu zasięgów organicznych', 'growth in organic reach'), {
      left: cx,
      top: p.height * 0.58,
      width: p.width * 0.8,
      fontSize: p.width * 0.045,
      fill: brand.text,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('vs poprzedni kwartał · dane własne', 'vs previous quarter · own data'), {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.8,
      fontSize: p.width * 0.026,
      fill: brand.text,
      originX: 'center',
      opacity: 0.5,
      fontFamily: brand.fontFamily,
    });
  },
};

const statsThree: DesignTemplate = {
  key: 'stats-three',
  category: 'stats',
  label: 'Three Numbers',
  labelPl: 'Trzy liczby',
  description: 'Headline with a row of three metrics',
  descriptionPl: 'Nagłówek i rząd trzech metryk',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('Nasz rok w liczbach', 'Our year in numbers'), {
      left: cx,
      top: p.height * 0.16,
      width: p.width * 0.85,
      fontSize: p.width * 0.06,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    const stats: [string, string][] = [
      ['1.2M', tx('wyświetleń', 'views')],
      ['48k', tx('obserwujących', 'followers')],
      ['312', tx('publikacji', 'posts')],
    ];
    stats.forEach(([num, label], i) => {
      const colX = p.width * (0.2 + 0.3 * i);
      addTextbox(canvas, num, {
        left: colX,
        top: p.height * 0.42,
        width: p.width * 0.26,
        fontSize: p.width * 0.075,
        fill: brand.primary,
        originX: 'center',
        fontWeight: 'bold',
        fontFamily: brand.fontFamily,
      });
      addTextbox(canvas, label, {
        left: colX,
        top: p.height * 0.52,
        width: p.width * 0.26,
        fontSize: p.width * 0.028,
        fill: brand.text,
        originX: 'center',
        opacity: 0.8,
        fontFamily: brand.fontFamily,
      });
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.64,
      width: p.width * 0.6,
      height: 2,
      fill: brand.text,
      opacity: 0.2,
      originX: 'center',
      selectable: false,
    });

    addTextbox(canvas, tx('Dziękujemy, że jesteście! 🙌', 'Thank you for being here! 🙌'), {
      left: cx,
      top: p.height * 0.72,
      width: p.width * 0.8,
      fontSize: p.width * 0.038,
      fill: brand.text,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const tipChecklist: DesignTemplate = {
  key: 'tip-checklist',
  category: 'tip',
  label: 'Checklist',
  labelPl: 'Checklista',
  description: 'Headline with three ticked items',
  descriptionPl: 'Nagłówek i trzy odhaczone punkty',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('Checklista przed publikacją', 'Pre-publish checklist'), {
      left: cx,
      top: p.height * 0.13,
      width: p.width * 0.85,
      fontSize: p.width * 0.055,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    const items = [
      tx('Hook w pierwszej linijce', 'Hook in the first line'),
      tx('Jedno wyraźne CTA', 'One clear CTA'),
      tx('Grafika w brandowych kolorach', 'On-brand visuals'),
    ];
    items.forEach((item, i) => {
      const rowTop = p.height * (0.3 + 0.16 * i);
      addRect(canvas, {
        left: cx,
        top: rowTop,
        width: p.width * 0.82,
        height: p.height * 0.11,
        fill: brand.text,
        opacity: 0.07,
        rx: p.width * 0.02,
        ry: p.width * 0.02,
        originX: 'center',
        selectable: false,
      });
      addTextbox(canvas, '✓', {
        left: p.width * 0.16,
        top: rowTop + p.height * 0.025,
        width: p.width * 0.08,
        fontSize: p.width * 0.05,
        fill: brand.primary,
        fontWeight: 'bold',
        fontFamily: brand.fontFamily,
      });
      addTextbox(canvas, item, {
        left: p.width * 0.26,
        top: rowTop + p.height * 0.032,
        width: p.width * 0.6,
        fontSize: p.width * 0.038,
        fill: brand.text,
        textAlign: 'left',
        fontFamily: brand.fontFamily,
      });
    });

    addTextbox(canvas, tx('Zapisz na później 📌', 'Save for later 📌'), {
      left: cx,
      top: p.height * 0.85,
      width: p.width * 0.8,
      fontSize: p.width * 0.03,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const tipProTip: DesignTemplate = {
  key: 'tip-pro-tip',
  category: 'tip',
  label: 'Pro Tip',
  labelPl: 'Pro Tip',
  description: 'Badge, one strong tip, save-this footer',
  descriptionPl: 'Plakietka, jedna mocna rada, stopka „zapisz"',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: cx,
      top: p.height * 0.16,
      width: p.width * 0.34,
      height: p.height * 0.07,
      fill: brand.primary,
      rx: p.height * 0.035,
      ry: p.height * 0.035,
      originX: 'center',
      selectable: false,
    });

    addTextbox(canvas, 'PRO TIP', {
      left: cx,
      top: p.height * 0.178,
      width: p.width * 0.34,
      fontSize: p.width * 0.035,
      fill: brand.background,
      originX: 'center',
      fontWeight: 'bold',
      charSpacing: 150,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Odpowiadaj na komentarze\nw pierwszej godzinie —\nalgorytm to wynagradza.', 'Reply to comments\nwithin the first hour —\nthe algorithm rewards it.'), {
      left: cx,
      top: p.height * 0.38,
      width: p.width * 0.85,
      fontSize: p.width * 0.06,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      lineHeight: 1.3,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('📌 Zapisz ten post', '📌 Save this post'), {
      left: cx,
      top: p.height * 0.82,
      width: p.width * 0.8,
      fontSize: p.width * 0.032,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const eventCountdown: DesignTemplate = {
  key: 'event-countdown',
  category: 'event',
  label: 'Countdown',
  labelPl: 'Odliczanie',
  description: 'Days-to-go countdown with event name',
  descriptionPl: 'Odliczanie dni z nazwą wydarzenia',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addTextbox(canvas, tx('JUŻ ZA', 'ONLY'), {
      left: cx,
      top: p.height * 0.18,
      width: p.width * 0.8,
      fontSize: p.width * 0.04,
      fill: brand.text,
      originX: 'center',
      charSpacing: 250,
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('3 DNI', '3 DAYS'), {
      left: cx,
      top: p.height * 0.27,
      width: p.width * 0.9,
      fontSize: p.width * 0.17,
      fill: brand.primary,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('do startu naszego webinaru', 'until our webinar goes live'), {
      left: cx,
      top: p.height * 0.5,
      width: p.width * 0.8,
      fontSize: p.width * 0.045,
      fill: brand.text,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });

    addRect(canvas, {
      left: cx,
      top: p.height * 0.64,
      width: p.width * 0.55,
      height: p.height * 0.08,
      fill: brand.text,
      opacity: 0.1,
      rx: p.height * 0.04,
      ry: p.height * 0.04,
      originX: 'center',
      selectable: false,
    });

    addTextbox(canvas, tx('Czwartek, 18:00', 'Thursday, 6 PM'), {
      left: cx,
      top: p.height * 0.662,
      width: p.width * 0.55,
      fontSize: p.width * 0.036,
      fill: brand.text,
      originX: 'center',
      fontWeight: 'bold',
      fontFamily: brand.fontFamily,
    });

    addTextbox(canvas, tx('Link w bio 🔗', 'Link in bio 🔗'), {
      left: cx,
      top: p.height * 0.84,
      width: p.width * 0.8,
      fontSize: p.width * 0.03,
      fill: brand.primary,
      originX: 'center',
      fontFamily: brand.fontFamily,
    });
  },
};

const eventAgenda: DesignTemplate = {
  key: 'event-agenda',
  category: 'event',
  label: 'Agenda',
  labelPl: 'Agenda',
  description: 'Header with three timed agenda rows',
  descriptionPl: 'Nagłówek i trzy punkty agendy z godzinami',
  apply: (canvas, p, brand, lang) => {
    const tx = pick(lang);
    clearCanvas(canvas, brand.background);
    const cx = p.width / 2;

    addRect(canvas, {
      left: 0,
      top: 0,
      width: p.width,
      height: p.height * 0.18,
      fill: brand.primary,
      selectable: false,
    });

    addTextbox(canvas, 'AGENDA', {
      left: cx,
      top: p.height * 0.06,
      width: p.width * 0.8,
      fontSize: p.width * 0.055,
      fill: brand.background,
      originX: 'center',
      fontWeight: 'bold',
      charSpacing: 200,
      fontFamily: brand.fontFamily,
    });

    const rows: [string, string][] = [
      ['18:00', tx('Powitanie i networking', 'Welcome & networking')],
      ['18:30', tx('Prezentacja główna', 'Main talk')],
      ['19:30', tx('Q&A i podsumowanie', 'Q&A and wrap-up')],
    ];
    rows.forEach(([time, item], i) => {
      const rowTop = p.height * (0.3 + 0.15 * i);
      addTextbox(canvas, time, {
        left: p.width * 0.12,
        top: rowTop,
        width: p.width * 0.18,
        fontSize: p.width * 0.045,
        fill: brand.primary,
        textAlign: 'left',
        fontWeight: 'bold',
        fontFamily: brand.fontFamily,
      });
      addTextbox(canvas, item, {
        left: p.width * 0.34,
        top: rowTop + p.height * 0.006,
        width: p.width * 0.55,
        fontSize: p.width * 0.036,
        fill: brand.text,
        textAlign: 'left',
        fontFamily: brand.fontFamily,
      });
      addRect(canvas, {
        left: cx,
        top: rowTop + p.height * 0.095,
        width: p.width * 0.76,
        height: 1.5,
        fill: brand.text,
        opacity: 0.15,
        originX: 'center',
        selectable: false,
      });
    });

    addTextbox(canvas, tx('Do zobaczenia! 👋', 'See you there! 👋'), {
      left: cx,
      top: p.height * 0.85,
      width: p.width * 0.8,
      fontSize: p.width * 0.034,
      fill: brand.text,
      originX: 'center',
      opacity: 0.7,
      fontFamily: brand.fontFamily,
    });
  },
};

export const BUILT_IN_TEMPLATES: DesignTemplate[] = [
  promoModern,
  promoBadge,
  quoteClassic,
  quoteMinimal,
  announcementBold,
  announcementBanner,
  statsHighlight,
  statsComparison,
  tipNumbered,
  tipDidYouKnow,
  eventDate,
  eventSaveDate,
  communityWelcome,
  communityThanks,
  reelCoverHook,
  reelCoverReveal,
  reelCoverList,
  promoFlashSale,
  promoPriceDrop,
  promoGiveaway,
  quoteReview,
  announcementHiring,
  announcementHours,
  announcementClosure,
  statsMilestone,
  tipDoDont,
  eventLive,
  communityQuestion,
  communityFollow,
  reelCoverBeforeAfter,
  quoteStatement,
  quoteMantra,
  statsBigNumber,
  statsThree,
  tipChecklist,
  tipProTip,
  eventCountdown,
  eventAgenda,
];

// A photo covering at least half the canvas is the design's background — it
// survives a template apply, with the layout landing ON the photo behind a
// readability scrim instead of being thrown away. Most common flow: generate
// a photo design with AI, then try a template on top of it.
const BG_COVERAGE_THRESHOLD = 0.5;

/** Returns true when the template was laid over a kept background photo. */
export const applyTemplate = async (
  template: DesignTemplate,
  canvas: fabric.Canvas,
  platform: PlatformSize,
  brand: BrandStyle,
  lang: TemplateLang
): Promise<boolean> => {
  const bgPhoto = canvas.getObjects().find((o) => {
    if (o.type !== 'image') return false;
    const w = (o.width || 0) * (o.scaleX || 1);
    const h = (o.height || 0) * (o.scaleY || 1);
    return w * h >= platform.width * platform.height * BG_COVERAGE_THRESHOLD;
  });
  const kept = bgPhoto ? await bgPhoto.clone() : null;

  // The template builds its text objects synchronously, and Fabric measures
  // each one as it is created. Have the families in the document first, or the
  // layout is sized for the fallback font and stays that way.
  await ensureFontsLoaded([brand.fontFamily, DEFAULT_FONT.family]);

  template.apply(canvas, platform, brand, lang);

  if (kept) {
    canvas.insertAt(0, kept);
    const scrim = new fabric.Rect({
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      width: platform.width,
      height: platform.height,
      fill: '#0a0e1a',
      opacity: 0.45,
      selectable: false,
    });
    canvas.insertAt(1, scrim);
  }

  canvas.renderAll();
  return !!kept;
};
