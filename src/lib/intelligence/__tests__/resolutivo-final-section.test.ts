import { describe, expect, it } from "vitest";
import { parseResolutivos } from "../resolutivo-parser";

describe("resolutivo parser final-section anchoring", () => {
  it("ignores an earlier quoted RESUELVE and uses the final numbered dispositive", () => {
    const text = `
ANTECEDENTES
La autoridad responsable resuelve el recurso administrativo y confirma el crédito.
Más adelante se transcribe que el tribunal inferior RESUELVE: PRIMERO. Se confirma la resolución administrativa.

ESTUDIO DE FONDO
La Suprema Corte considera fundado el agravio.

R E S U E L V E:
PRIMERO. Se revoca la sentencia recurrida.
SEGUNDO. Devuélvanse los autos al Tribunal Colegiado para los efectos precisados.
NOTIFÍQUESE.
`;

    const parsed = parseResolutivos(text);
    expect(parsed.found).toBe(true);
    expect(parsed.dispositions).toHaveLength(2);
    expect(parsed.dispositions[0]?.type).toBe("revoca");
    expect(parsed.dispositions[0]?.text).toContain("Se revoca la sentencia recurrida");
    expect(parsed.dispositions.map((d) => d.text).join(" ")).not.toContain("confirma la resolución administrativa");
  });

  it("supports a single final UNICO disposition", () => {
    const text = `CONSIDERANDO...\nSE RESUELVE:\nÚNICO.- La Justicia de la Unión ampara y protege a la parte quejosa.\nNOTIFÍQUESE.`;
    const parsed = parseResolutivos(text);
    expect(parsed.dispositions).toHaveLength(1);
    expect(parsed.dispositions[0]?.type).toBe("concede");
  });
});
