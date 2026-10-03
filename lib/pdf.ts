// Extrae el texto de un PDF con pdf-parse.
import { PDFParse } from "pdf-parse";

export async function extraerTexto(datos: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: datos });
  try {
    const resultado = await parser.getText();
    return resultado.text;
  } finally {
    await parser.destroy();
  }
}
