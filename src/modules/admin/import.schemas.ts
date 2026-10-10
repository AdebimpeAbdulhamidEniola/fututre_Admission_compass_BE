import { z } from "zod";

/**
 * Body of POST /admin/import/university(/preview): the uploaded sheet as a grid of cells, read in
 * the browser (read-excel-file) and sent as-is. All parsing and validation happens server-side in
 * import.service.ts, so there's one source of truth for the format.
 */
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const universityImportSchema = z.object({
  rows: z.array(z.array(cellSchema).max(60)).min(1).max(2000),
});
export type UniversityImportInput = z.infer<typeof universityImportSchema>;
export type Cell = z.infer<typeof cellSchema>;

export interface ImportIssue {
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
