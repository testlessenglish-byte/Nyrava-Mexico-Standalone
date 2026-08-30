

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
