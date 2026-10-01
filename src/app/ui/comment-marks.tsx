const ANSWER_GLYPHS: Record<string, string> = {
  boolean: "✓",
  checkbox: "☰",
  number: "#",
  range: "↔",
  text: "T",
  date: "◷",
};

/** Answer type as a small monospace glyph. For the editor in slice 5. */
export function AnswerTypeGlyph({ answerType }: { answerType: string }) {
  return (
    <span className="w-3 text-center font-mono text-[10px] text-neutral-400">
      {ANSWER_GLYPHS[answerType] ?? "·"}
    </span>
  );
}

/** Comment type told apart by fill, never by colour. defect filled, limit grey, info outline. */
export function CommentTypeDot({ commentType }: { commentType: string }) {
  const fill =
    commentType === "defect"
      ? "bg-neutral-900 dark:bg-white"
      : commentType === "limit"
        ? "bg-neutral-500"
        : "border border-neutral-400";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fill}`} />;
}
