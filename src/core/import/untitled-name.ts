const UNTITLED_NAME: Record<string, string> = {
  "Section Name": "Untitled Section",
  "Item Name": "Untitled Item",
  "Comment Name": "Untitled Comment",
};

/** Stored name when `field` is blank. Reconcile keeps its own copy of these three titles. */
export function untitledName(field: string): string {
  return UNTITLED_NAME[field] ?? "Untitled";
}
