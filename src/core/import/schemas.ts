import { z } from "zod";
import { cutKinds } from "@/core/sanitise";
import { catalogue, issueKinds } from "@/core/import/catalogue";

const nonBlankName = z.string().refine((name) => name.trim() !== "", { message: "Name is blank" });

const categorySchema = z.union([z.literal(-1), z.literal(0), z.literal(1), z.null()]);

/** Comment types a stored Comment may have. Compared with `comments_comment_type_check`. */
export const commentTypes = ["info", "limit", "defect"] as const;

/** Answer types a stored Comment may have. Compared with `comments_answer_type_check`. */
export const answerTypes = ["boolean", "checkbox", "number", "range", "text", "date"] as const;

/** Which option list a `comment_options` row belongs to. Compared with `comment_options_list_check`. */
export const optionLists = ["choice", "unit"] as const;

export const commentSchema = z.object({
  id: z.string().optional(),
  sourceRow: z.number().int().positive().nullable(),
  name: nonBlankName,
  textHtml: z.string(),
  commentType: z.enum(commentTypes),
  category: categorySchema,
  recommendation: z.string().nullable(),
  answerType: z.enum(answerTypes),
  defaultBoolean: z.boolean().nullable(),
  defaultText: z.string().nullable(),
  choiceOptions: z.array(z.string()),
  unitOptions: z.array(z.string()),
});

export const itemSchema = z.object({
  id: z.string().optional(),
  name: nonBlankName,
  comments: z.array(commentSchema),
});

export const sectionSchema = z.object({
  id: z.string().optional(),
  name: nonBlankName,
  items: z.array(itemSchema),
});

/** Names must be non-blank after trimming. Empty Sections and Items, and duplicate names, are allowed. */
export const editableTreeSchema = z.object({
  sections: z.array(sectionSchema),
});

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const cutEvidenceSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  kind: z.enum(cutKinds),
  removedText: z.string(),
  replacement: z.string().nullable(),
});

export const importIssueSchema = z
  .object({
    kind: z.enum(issueKinds),
    sourceRow: z.number().int().positive().nullable(),
    detail: z.unknown(),
    cuts: z.array(cutEvidenceSchema),
  })
  .superRefine((issue, ctx) => {
    const entry = catalogue.find((candidate) => candidate.kind === issue.kind);
    if (!entry) return;
    const parsed = entry.detail.safeParse(issue.detail);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: "Import issue detail does not match its kind",
        path: ["detail"],
      });
    }
  });

const runSchema = z.object({
  filename: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().nonnegative(),
  sheetName: z.string(),
  headers: z.array(z.string()),
  rowsRead: z.number().int().nonnegative(),
  blankRows: z.number().int().nonnegative(),
  valuesDecoded: z.number().int().nonnegative(),
});

const sourceRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  cells: z.array(cellSchema),
});

function sameWidth(
  value: { run: { headers: string[] }; sourceRows: { rowNumber: number; cells: unknown[] }[] },
  ctx: z.core.$RefinementCtx,
) {
  const width = value.run.headers.length;
  for (const [index, row] of value.sourceRows.entries()) {
    if (row.cells.length !== width) {
      ctx.addIssue({
        code: "custom",
        message: `Source row ${row.rowNumber} has ${row.cells.length} cells; the header has ${width}`,
        path: ["sourceRows", index, "cells"],
      });
    }
  }
}

export const importEvidenceSchema = z
  .object({
    run: runSchema,
    sourceRows: z.array(sourceRowSchema),
    issues: z.array(importIssueSchema),
  })
  .superRefine(sameWidth);

export const importDraftSchema = importEvidenceSchema.extend({
  suggestedName: z.string().min(1),
  tree: editableTreeSchema,
});

export type EditableTree = z.infer<typeof editableTreeSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type ImportIssue = z.infer<typeof importIssueSchema>;
export type ImportEvidence = z.infer<typeof importEvidenceSchema>;
export type ImportDraft = z.infer<typeof importDraftSchema>;

export function countEditableTree(tree: EditableTree): { sections: number; items: number; comments: number } {
  let items = 0;
  let comments = 0;
  for (const section of tree.sections) {
    items += section.items.length;
    for (const item of section.items) {
      comments += item.comments.length;
    }
  }
  return { sections: tree.sections.length, items, comments };
}
