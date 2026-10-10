import { z } from "zod";

/**
 * Body of POST /admin/import/university(/preview): the workbook's two sheets ("University" and
 * "Courses") as grids of cells, read in the browser (read-excel-file) and sent as-is. All parsing
 * and validation happens server-side in import.service.ts, so there's one source of truth for the
 * format.
 */
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const sheetSchema = z.array(z.array(cellSchema).max(60)).max(2000);

export const universityImportSchema = z.object({
  university: sheetSchema.min(1),
  courses: sheetSchema.min(1),
});
export type UniversityImportInput = z.infer<typeof universityImportSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type WorkbookSheets = { university: Cell[][]; courses: Cell[][] };
export type SheetName = "University" | "Courses";

export interface ImportIssue {
  sheet: SheetName;
  /** 1-based spreadsheet row number. */
  row: number;
  column: string;
  message: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface CoursePreview {
  row: number;
  name: string;
  action: "create" | "update" | "unchanged";
  changes: FieldChange[];
}

export interface ImportPreview {
  valid: boolean;
  errors: ImportIssue[];
  universityCode: string | null;
  universityAction: "create" | "update" | "unchanged" | null;
  universityChanges: FieldChange[];
  courses: CoursePreview[];
  /** Existing courses at this university that aren't in the file — kept as they are. */
  untouchedCourses: string[];
}
