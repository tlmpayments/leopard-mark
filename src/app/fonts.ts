import localFont from "next/font/local";

/**
 * The two typefaces of the internal screens, both Google Fonts (SIL Open Font License), served from the app
 * itself through the @fontsource-variable packages so no request leaves for a font CDN: Rubik for all UI,
 * forms and data; Merriweather for display only (page titles, BOL and invoice numbers, section labels).
 * next/font sizes the fallback faces to the real metrics so text does not jump when the fonts arrive.
 */
export const rubik = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/rubik/files/rubik-latin-wght-italic.woff2", style: "italic" },
  ],
  weight: "300 900",
  display: "swap",
  variable: "--font-rubik",
  adjustFontFallback: "Arial",
});

export const merriweather = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/merriweather/files/merriweather-latin-wght-normal.woff2", style: "normal" }],
  weight: "300 900",
  display: "swap",
  variable: "--font-merriweather",
  adjustFontFallback: "Times New Roman",
});
