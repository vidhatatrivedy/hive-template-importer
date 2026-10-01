import type { Segment } from "@/app/cut-segments";
import type { SourceRowView } from "@/app/source-row-view";
import { labelClass, severityClass } from "@/app/ui/classes";
import { CommentHtml } from "@/app/ui/comment-html";

/** The Source row view, in place of the Trust Report. The back link lives in the sheet header. */
export function SourceRowBody({ view }: { view: SourceRowView }) {
  if (view.kind === "missing") return <p>{view.message}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-medium text-neutral-900 dark:text-white">{view.title}</h3>
        {view.location ? <p className="text-neutral-500">{view.location}</p> : null}
      </div>

      <section className="flex flex-col gap-1">
        <h3 className={labelClass}>Changed fields</h3>
        {view.exact ? (
          <p>{view.exact}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.fields.map((field, index) => (
              <li key={`${field.column}-${index}`} className="break-words">
                <span className="font-medium text-neutral-900 dark:text-white">{field.column}</span>{" "}
                <span className="whitespace-pre-wrap">{field.raw}</span>
                {" → "}
                <span className="whitespace-pre-wrap">{field.stored}</span>
                <span className="text-neutral-500"> · {field.explanation}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.issues.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className={labelClass}>Import issues</h3>
          <ul className="flex flex-col gap-1">
            {view.issues.map((issue, index) => (
              <li key={`${issue.message}-${index}`} className={severityClass[issue.severity]}>
                {issue.severity} · {issue.class} · {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <h3 className={labelClass}>Comment Text</h3>
        <p className="whitespace-pre-wrap break-words font-mono text-[11px]">
          {view.segments.map((segment, index) => (
            <CommentTextSegment key={index} segment={segment} />
          ))}
        </p>
        {view.textNote ? <p>{view.textNote}</p> : null}
        <p className="text-neutral-500">{view.storedLabel}</p>
        <CommentHtml html={view.storedHtml} sourceRow={view.row} />
      </section>

      <details className="border-t border-black/[0.05] pt-2 dark:border-white/[0.06]">
        <summary className={`${labelClass} cursor-pointer`}>All cells</summary>
        <dl className="mt-2 flex flex-col gap-2">
          {view.cells.map((cell, index) => (
            <div key={`${cell.header}-${index}`}>
              <dt className="text-neutral-500">{columnHeading(cell.header, index)}</dt>
              <dd className="whitespace-pre-wrap break-words font-mono text-[11px]">{cell.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function columnHeading(header: string, index: number): string {
  if (header.trim() !== "") return header;
  return `Column ${index + 1}`;
}

function CommentTextSegment({ segment }: { segment: Segment }) {
  switch (segment.kind) {
    case "kept":
      return <span>{segment.text}</span>;
    case "removed":
      return (
        <span>
          <del>{segment.text}</del>
          <span className={`${labelClass} ml-1`}>{segment.cutKind}</span>
        </span>
      );
    case "inserted":
      return (
        <span>
          <ins className="no-underline">{segment.text}</ins>
          <span className={`${labelClass} ml-1`}>inserted</span>
        </span>
      );
  }
}
