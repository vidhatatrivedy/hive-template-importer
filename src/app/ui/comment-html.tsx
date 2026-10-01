"use client";

import { useEffect, useState } from "react";
import { applyCommentHtmlDisplayAttributes, commentHtmlPurifyConfig } from "@/core/sanitise/purify-config";
import styles from "./comment-html.module.css";

/**
 * Renders stored Comment HTML through DOMPurify with core's config.
 * DOMPurify is loaded in the browser only. The server and the first paint share this empty box.
 */
export function CommentHtml({ html, sourceRow }: { html: string; sourceRow: number | null }) {
  const [clean, setClean] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("dompurify").then((mod) => {
      if (cancelled) return;
      const purify = mod.default(window);
      purify.addHook("afterSanitizeAttributes", applyCommentHtmlDisplayAttributes);
      try {
        const output = String(purify.sanitize(html, commentHtmlPurifyConfig));
        if (purify.removed.length > 0) {
          const where = sourceRow === null ? "a Comment with no Source row" : `Source row ${sourceRow}`;
          console.error(`DOMPurify removed markup from ${where}`, purify.removed);
        }
        if (!cancelled) setClean(output);
      } finally {
        purify.removeHook("afterSanitizeAttributes", applyCommentHtmlDisplayAttributes);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [html, sourceRow]);

  return (
    <div className={styles.commentHtml} aria-busy={clean === null}>
      {clean === null ? null : <div dangerouslySetInnerHTML={{ __html: clean }} />}
    </div>
  );
}
