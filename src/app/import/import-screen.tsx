"use client";

import { useReducer, useRef, useTransition, type DragEvent, type FormEvent } from "react";
import { importErrorMessage } from "@/core/import/import-errors";
import { commitImport, previewImport } from "@/app/import/actions";
import { importFlow, initialImportFlow, type ImportFlow, type ImportFlowEvent } from "@/app/import/import-flow";
import type { ImportReview } from "@/app/import/import-review";
import { buttonClass, glassClass, labelClass, primaryButtonClass } from "@/app/ui/classes";

/** The upload, Import review and rejection screens: one page, one state machine, no URL per step. */
export function ImportScreen() {
  const [flow, dispatch] = useReducer(importFlow, initialImportFlow);
  const [, startTransition] = useTransition();

  /** Applies an event and returns the step it leads to, so the caller knows whether to send anything. */
  function send(event: ImportFlowEvent): ImportFlow {
    dispatch(event);
    return importFlow(flow, event);
  }

  function read(next: ImportFlow) {
    if (next.step !== "reading") return;
    const { file } = next;
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await previewImport(formData);
      startTransition(() => dispatch({ type: "preview-returned", file, result }));
    });
  }

  function choose(file: File | undefined) {
    if (file) read(send({ type: "file-chosen", file }));
  }

  function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = send({ type: "import" });
    if (next.step !== "committing") return;
    const { file } = next;
    const formData = new FormData(event.currentTarget);
    formData.set("file", file);
    startTransition(async () => {
      const result = await commitImport(formData);
      startTransition(() => dispatch({ type: "commit-failed", file, error: result.error }));
    });
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    choose(event.dataTransfer.files[0]);
  }

  return (
    <section
      className={`${glassClass} flex w-[460px] flex-col gap-4 rounded-2xl px-8 py-7`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <p className={labelClass}>Import a Spectora template</p>
      {flow.step === "idle" ? <ChooseFile onChoose={choose} /> : null}
      {flow.step === "reading" ? <p>Reading {flow.file.name}…</p> : null}
      {flow.step === "reviewing" || flow.step === "committing" ? (
        <Review
          review={flow.review}
          name={flow.name}
          committing={flow.step === "committing"}
          onName={(name) => send({ type: "name-edited", name })}
          onCancel={() => send({ type: "cancel" })}
          onSubmit={commit}
        />
      ) : null}
      {flow.step === "rejected" ? (
        <div className="flex flex-col gap-3">
          <p className="truncate text-neutral-500">{flow.filename}</p>
          <h1 className="text-[14px] font-medium text-neutral-900 dark:text-white">
            {flow.error.kind === "hash-mismatch" ? "This file changed" : "This file can't be imported"}
          </h1>
          <p>{importErrorMessage(flow.error)}</p>
          <div className="flex gap-2">
            <button type="button" className={primaryButtonClass} onClick={() => send({ type: "choose-another" })}>
              Choose another file
            </button>
            {flow.error.kind === "hash-mismatch" && flow.file ? (
              <button type="button" className={buttonClass} onClick={() => read(send({ type: "review-again" }))}>
                Review again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ChooseFile({ onChoose }: { onChoose: (file: File | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-black/[0.15] px-6 py-10 text-center dark:border-white/[0.15]">
      <p>Drop a Spectora export here</p>
      <button type="button" className={primaryButtonClass} onClick={() => input.current?.click()}>
        Choose file
      </button>
      <input
        ref={input}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={(event) => {
          onChoose(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <p className="text-neutral-500">Template → ⋮ → Export to spreadsheet → Export HTML Text</p>
    </div>
  );
}

function Review({
  review,
  name,
  committing,
  onName,
  onCancel,
  onSubmit,
}: {
  review: ImportReview;
  name: string;
  committing: boolean;
  onName: (name: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { counts, issueCounts } = review;
  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <p className="truncate text-neutral-500">{review.filename}</p>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Name</span>
        <input
          name="name"
          value={name}
          autoFocus
          readOnly={committing}
          onChange={(event) => onName(event.currentTarget.value)}
          className="h-7 rounded-md border border-black/[0.08] bg-white/60 px-2 text-[12px] dark:border-white/[0.1] dark:bg-neutral-900/60"
        />
      </label>
      <input type="hidden" name="sha256" value={review.sha256} />
      <p className="tabular-nums">
        {counts.rowsRead} rows read → {counts.sections} Sections · {counts.items} Items · {counts.comments} Comments
        {counts.blankRows > 0 ? ` · ${counts.blankRows} blank rows ignored` : ""}
      </p>
      <p className="tabular-nums">
        {plural(issueCounts.warning, "warning")} · {plural(issueCounts.notice, "notice")}
      </p>
      <p className="text-neutral-500">{committing ? "Importing…" : "Nothing is stored until you press Import."}</p>
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} disabled={committing || name.trim() === ""}>
          Import
        </button>
        <button type="button" className={buttonClass} disabled={committing} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
