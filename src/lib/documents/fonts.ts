import { readFileSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * The document typefaces: Rubik for everything, Merriweather for the title, the number and the section labels,
 * the same two Google Fonts the screens use (SIL Open Font License). The WOFF files come from the @fontsource
 * packages in node_modules and are read once per process into data URLs, so the renderer never fetches anything;
 * next.config.ts traces the files into the serverless bundle (outputFileTracingIncludes).
 */
const RUBIK = ["400-normal", "400-italic", "500-normal", "700-normal"] as const;
const MERRIWEATHER = ["400-normal", "700-normal", "900-normal"] as const;

// Built from pieces so the bundler's static file tracing does not pull the whole font directories in; next.config.ts
// lists the latin WOFF files explicitly (outputFileTracingIncludes).
const FONT_ROOT = ["node_modules", "@fontsource"];

function dataUrl(pkg: string, file: string): string {
  const p = path.resolve(process.cwd(), [...FONT_ROOT, pkg, "files", file].join(path.sep));
  return `data:font/woff;base64,${readFileSync(p).toString("base64")}`;
}

let registered = false;

/** Idempotent: the renderer calls this before the first document of the process. */
export function registerDocumentFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Rubik",
    fonts: RUBIK.map((v) => {
      const [weight, style] = v.split("-");
      return { src: dataUrl("rubik", `rubik-latin-${v}.woff`), fontWeight: Number(weight), fontStyle: style as "normal" | "italic" };
    }),
  });
  Font.register({
    family: "Merriweather",
    fonts: MERRIWEATHER.map((v) => {
      const [weight] = v.split("-");
      return { src: dataUrl("merriweather", `merriweather-latin-${v}.woff`), fontWeight: Number(weight) };
    }),
  });
}
