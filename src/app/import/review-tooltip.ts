/** The Import review tooltip payload: capped lines, plus how many did not fit. */
export type ReviewTooltip = {
  lines: string[];
  more: number;
};

/** Lines the tooltip shows. A remaining count becomes a final "+ n more" line. */
export function reviewTooltipText(tip: ReviewTooltip): string[] {
  if (tip.more <= 0) return tip.lines;
  return [...tip.lines, `+ ${tip.more} more`];
}
