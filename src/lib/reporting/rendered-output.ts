import { strFromU8, unzipSync } from "fflate";
import { releaseRenderedReportOutput, type FinalReportPayload } from "./final-report-contract";

/** Capture the exact strings reaching jsPDF, including table cells and footers. */
export function capturePdfText(doc: { text: (...args: any[]) => any }): string[] {
  const output: string[] = [];
  const original = doc.text.bind(doc);
  doc.text = (text: any, ...rest: any[]) => {
    const collect = (value: any): void => {
      if (typeof value === "string") output.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    collect(text);
    return original(text, ...rest);
  };
  return output;
}

/** Inspect text from the actual packed document, including headers/footers.
 * The bytes checked here are the same Blob passed to saveBlob. */
export async function releaseDocxOutput(payload: FinalReportPayload, blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const text = Object.entries(files).filter(([name]) => /^word\/.*\.xml$/.test(name))
    .map(([, bytes]) => strFromU8(bytes).replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join("\n");
  const previous = payload.report_presentation.render_output;
  return releaseRenderedReportOutput(payload, previous ? previous.format + "+docx" : "docx",
    [previous?.text,text].filter(Boolean).join("\n"));
}
