import "server-only";
import type ExcelJS from "exceljs";

/**
 * Puts the company logo at the top right of a worksheet (over the title rows), about 40 px high.
 * `atColumn` is the zero-based column where the logo starts.
 */
export function addLogo(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, logo: { png: Buffer; width: number; height: number } | null | undefined, atColumn: number) {
  if (!logo) return;
  const id = wb.addImage({ base64: logo.png.toString("base64"), extension: "png" });
  const scale = Math.min(160 / logo.width, 40 / logo.height);
  ws.addImage(id, { tl: { col: atColumn, row: 0 }, ext: { width: Math.round(logo.width * scale), height: Math.round(logo.height * scale) }, editAs: "absolute" });
  ws.getRow(1).height = Math.max(ws.getRow(1).height ?? 15, 32);
}
