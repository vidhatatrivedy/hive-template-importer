"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, type ReactNode, type Ref } from "react";
import { saveErrorMessage } from "@/core/import/editor-messages";
import type { Comment, EditableTree, Item, Section } from "@/core/import/schemas";
import { ADDED_IN_THE_EDITOR } from "@/app/editor/added-in-the-editor";
import {
  commentGroups,
  editorReducer,
  initialEditorState,
  isDirty,
  locate,
  type Column,
  type EditorState,
} from "@/app/editor/editor-state";
import { templateHref } from "@/app/template-view";
import { buttonClass, labelClass, primaryButtonClass } from "@/app/ui/classes";
import { CommentHtml } from "@/app/ui/comment-html";
import { AnswerTypeGlyph, CommentTypeDot } from "@/app/ui/comment-marks";
import { saveTemplate } from "./actions";

const COLUMNS = ["sections", "items", "comments"] as const;

const TYPE_LABEL: Record<Comment["commentType"], string> = {
  info: "Informational",
  limit: "Limitation",
  defect: "Deficiency",
};

const ANSWER_LABEL: Record<Comment["answerType"], string> = {
  boolean: "Boolean",
  checkbox: "Checkbox",
  number: "Number",
  range: "Range",
  text: "Text",
  date: "Date",
};

/**
 * The Template editor. One reducer, not keyed on the search params, so toggling a sheet
 * keeps the selection. A change of `row` selects that Source row.
 */
export function Editor({
  templateId,
  templateName,
  versionId,
  versionNumber,
  tree,
  row,
  versionsOpen,
  counts,
  children,
}: {
  templateId: string;
  templateName: string;
  versionId: string;
  versionNumber: number;
  tree: EditableTree;
  row: number | null;
  versionsOpen: boolean;
  counts: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    editorReducer,
    { versionId, number: versionNumber, tree, row },
    initialEditorState,
  );
  const loadedVersion = useRef(versionId);
  const loadedRow = useRef(row);
  const commentNodes = useRef(new Map<string, HTMLButtonElement>());
  const saveLock = useRef(false);
  const runSaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (versionId === loadedVersion.current) return;
    loadedVersion.current = versionId;
    dispatch({ type: "serverVersion", versionId, number: versionNumber, tree });
  }, [versionId, versionNumber, tree]);

  async function runSave() {
    if (saveLock.current || !isDirty(state) || state.save.status === "saving" || state.save.status === "awaiting") {
      return;
    }
    saveLock.current = true;
    const baseNumber = state.base.number;
    const working = state.tree;
    dispatch({ type: "saveRequested" });
    try {
      const result = await saveTemplate(templateId, baseNumber, working);
      if (!result.ok) {
        dispatch({ type: "saveFailed", error: result.error });
        return;
      }
      dispatch({ type: "saveSucceeded", number: result.number });
    } catch {
      dispatch({ type: "saveFailed", error: { kind: "save-failed" } });
    } finally {
      saveLock.current = false;
    }
  }

  useEffect(() => {
    runSaveRef.current = () => void runSave();
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      runSaveRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (row === loadedRow.current) return;
    loadedRow.current = row;
    if (row !== null) dispatch({ type: "selectRow", row });
  }, [row]);

  useEffect(() => {
    if (row === null || state.rowMiss !== null) return;
    const commentId = state.selection.commentId;
    if (!commentId) return;
    commentNodes.current.get(commentId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [row, state.rowMiss, state.selection.commentId]);

  const { section, item, comment } = locate(state.tree, state.selection);
  const focusColumn = (column: Column) => dispatch({ type: "focus", column });
  const indicator = saveIndicator(state);
  const canSave = isDirty(state) && state.save.status !== "saving" && state.save.status !== "awaiting";
  const nameLocked = state.save.status === "saving" || state.save.status === "awaiting";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
        <Breadcrumb
          templateName={templateName}
          sectionName={section?.name ?? null}
          itemName={item?.name ?? null}
          commentName={comment?.name ?? null}
          onFocus={focusColumn}
        />
        <p className="shrink-0 text-neutral-500 tabular-nums">{counts}</p>
        {indicator ? (
          <p aria-live="polite" className="shrink-0 text-neutral-500">
            {indicator}
          </p>
        ) : null}
        <button
          type="button"
          className={`${primaryButtonClass} shrink-0`}
          disabled={!canSave}
          onClick={() => void runSave()}
        >
          Save
        </button>
        {children}
      </header>
      {state.save.status === "refused" ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 py-2 dark:border-white/[0.06]">
          <p className="min-w-0 flex-1">{saveErrorMessage(state.save.error)}</p>
          <button type="button" className={buttonClass} onClick={() => dispatch({ type: "dismissError" })}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <EditorColumn
          title="Sections"
          collapsed={isCollapsed("sections", state.focus)}
          stripText={section?.name ?? ""}
          onFocus={() => focusColumn("sections")}
        >
          <ul>
            {state.tree.sections.map((candidate) => {
              const id = candidate.id;
              if (!id) return null;
              return (
                <li key={id}>
                  <RowButton
                    selected={id === state.selection.sectionId}
                    title={candidate.name}
                    onClick={() => dispatch({ type: "select", ref: { level: "section", id } })}
                  >
                    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                  </RowButton>
                </li>
              );
            })}
          </ul>
        </EditorColumn>
        <EditorColumn
          title="Items"
          collapsed={isCollapsed("items", state.focus)}
          stripText={item?.name ?? ""}
          onFocus={() => focusColumn("items")}
        >
          <ul>
            {section?.items.map((candidate) => {
              const id = candidate.id;
              if (!id) return null;
              return (
                <li key={id}>
                  <RowButton
                    selected={id === state.selection.itemId}
                    title={candidate.name}
                    onClick={() => dispatch({ type: "select", ref: { level: "item", id } })}
                  >
                    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                    <span
                      className="shrink-0 tabular-nums text-neutral-400"
                      aria-label={`${candidate.comments.length} Comments`}
                    >
                      {candidate.comments.length}
                    </span>
                  </RowButton>
                </li>
              );
            })}
          </ul>
        </EditorColumn>
        <EditorColumn
          title="Comments"
          collapsed={isCollapsed("comments", state.focus)}
          stripText={comment?.name ?? ""}
          onFocus={() => focusColumn("comments")}
        >
          {item
            ? commentGroups(item.comments).map((group) => (
                <div key={group.label}>
                  <h3 className={`${labelClass} px-3 pt-2 pb-1`}>{group.label}</h3>
                  <ul>
                    {group.comments.map((candidate) => {
                      const id = candidate.id;
                      if (!id) return null;
                      return (
                        <li key={id}>
                          <RowButton
                            selected={id === state.selection.commentId}
                            title={candidate.name}
                            sourceRow={candidate.sourceRow ?? undefined}
                            buttonRef={(node) => {
                              if (node) commentNodes.current.set(id, node);
                              else commentNodes.current.delete(id);
                            }}
                            onClick={() => dispatch({ type: "select", ref: { level: "comment", id } })}
                          >
                            <CommentTypeDot commentType={candidate.commentType} />
                            <AnswerTypeGlyph answerType={candidate.answerType} />
                            <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                          </RowButton>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            : null}
        </EditorColumn>
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3">
          <CommentPane
            rowMiss={state.rowMiss}
            templateId={templateId}
            versionsOpen={versionsOpen}
            section={section}
            item={item}
            comment={comment}
            nameLocked={nameLocked}
            onName={(name) => {
              if (!comment?.id) return;
              dispatch({ type: "setComment", id: comment.id, patch: { name } });
            }}
          />
        </section>
      </div>
    </div>
  );
}

function CommentPane({
  rowMiss,
  templateId,
  versionsOpen,
  section,
  item,
  comment,
  nameLocked,
  onName,
}: {
  rowMiss: number | null;
  templateId: string;
  versionsOpen: boolean;
  section: Section | null;
  item: Item | null;
  comment: Comment | null;
  nameLocked: boolean;
  onName: (name: string) => void;
}) {
  if (rowMiss !== null) {
    return <p className="text-neutral-500">No Comment in this Version carries Source row {rowMiss}.</p>;
  }
  if (!section || !item || !comment) return null;
  return (
    <CommentDetail
      templateId={templateId}
      versionsOpen={versionsOpen}
      sectionName={section.name}
      itemName={item.name}
      comment={comment}
      nameLocked={nameLocked}
      onName={onName}
    />
  );
}

function CommentDetail({
  templateId,
  versionsOpen,
  sectionName,
  itemName,
  comment,
  nameLocked,
  onName,
}: {
  templateId: string;
  versionsOpen: boolean;
  sectionName: string;
  itemName: string;
  comment: Comment;
  nameLocked: boolean;
  onName: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-neutral-500">
          {sectionName} / {itemName}
        </p>
        {comment.sourceRow !== null ? (
          <Link
            href={commentSourceHref(templateId, versionsOpen, comment.sourceRow)}
            className="shrink-0 underline underline-offset-2"
          >
            Source row {comment.sourceRow}
          </Link>
        ) : (
          <p className="max-w-56 text-right text-neutral-400">{ADDED_IN_THE_EDITOR}</p>
        )}
      </div>
      <input
        aria-label="Name"
        value={comment.name}
        readOnly={nameLocked}
        onChange={(event) => onName(event.currentTarget.value)}
        className="w-full rounded-md border border-transparent bg-transparent px-1 text-[15px] font-medium text-neutral-900 outline-none hover:border-black/10 focus:border-black/20 dark:text-white dark:hover:border-white/15 dark:focus:border-white/25"
      />
      <div className="grid grid-cols-4 gap-3">
        <Field label="Type" value={TYPE_LABEL[comment.commentType]} />
        <Field label="Answer" value={ANSWER_LABEL[comment.answerType]} />
        {comment.commentType === "defect" ? <Field label="Category" value={categoryLabel(comment.category)} /> : null}
        <Field label="Recommendation" value={comment.recommendation ?? "None"} />
      </div>
      {comment.answerType === "checkbox" ? (
        <div>
          <div className={labelClass}>Options</div>
          {comment.choiceOptions.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-1">
              {comment.choiceOptions.map((option, index) => (
                <li
                  key={`${index}-${option}`}
                  className="rounded-full border border-black/10 px-2 py-0.5 dark:border-white/10"
                >
                  {option}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-neutral-500">None</p>
          )}
        </div>
      ) : null}
      <Field label="Default" value={defaultLabel(comment)} />
      <div className="border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
        <CommentHtml html={comment.textHtml} sourceRow={comment.sourceRow} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className={labelClass}>{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}

function Breadcrumb({
  templateName,
  sectionName,
  itemName,
  commentName,
  onFocus,
}: {
  templateName: string;
  sectionName: string | null;
  itemName: string | null;
  commentName: string | null;
  onFocus: (column: Column) => void;
}) {
  return (
    <nav aria-label="Template" className="flex min-w-0 items-center gap-1.5">
      <h1 className="min-w-0 max-w-40 truncate font-medium text-neutral-900 dark:text-white">
        <button type="button" className="truncate hover:underline" onClick={() => onFocus("sections")}>
          {templateName}
        </button>
      </h1>
      {sectionName ? <Crumb label={sectionName} onClick={() => onFocus("sections")} /> : null}
      {itemName ? <Crumb label={itemName} onClick={() => onFocus("items")} /> : null}
      {commentName ? <Crumb label={commentName} onClick={() => onFocus("comments")} /> : null}
    </nav>
  );
}

function Crumb({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <>
      <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
        /
      </span>
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 max-w-40 truncate text-neutral-700 hover:underline dark:text-neutral-200"
      >
        {label}
      </button>
    </>
  );
}

function EditorColumn({
  title,
  collapsed,
  stripText,
  onFocus,
  children,
}: {
  title: string;
  collapsed: boolean;
  stripText: string;
  onFocus: () => void;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onFocus}
        aria-label={stripText ? `${title}, ${stripText}` : title}
        className="flex h-full min-h-0 w-8 shrink-0 flex-col items-center gap-2 border-r border-black/[0.05] py-2 dark:border-white/[0.06]"
      >
        <span className="min-h-0 w-full flex-1 overflow-hidden text-center [writing-mode:vertical-rl] rotate-180">
          {stripText}
        </span>
        <span className={`${labelClass} shrink-0 [writing-mode:vertical-rl] rotate-180`}>{title}</span>
      </button>
    );
  }
  return (
    <section className="flex min-h-0 w-56 shrink-0 flex-col border-r border-black/[0.05] dark:border-white/[0.06]">
      <h2 className={`${labelClass} px-3 py-2`}>{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function RowButton({
  selected,
  onClick,
  title,
  buttonRef,
  sourceRow,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  buttonRef?: Ref<HTMLButtonElement>;
  sourceRow?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      title={title}
      data-source-row={sourceRow}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1 text-left ${
        selected ? "bg-black/[0.06] dark:bg-white/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

function saveIndicator(state: EditorState): string | null {
  if (state.save.status === "saving" || state.save.status === "awaiting") return "Saving…";
  if (isDirty(state)) return "Unsaved changes";
  return null;
}

function isCollapsed(column: Column, focus: Column): boolean {
  return COLUMNS.indexOf(column) < COLUMNS.indexOf(focus);
}

/** Source row view on this Template, keeping the Versions sheet open when it already is. */
function commentSourceHref(templateId: string, versionsOpen: boolean, sourceRow: number): string {
  const panes = new Set<"trust" | "versions">(["trust"]);
  if (versionsOpen) panes.add("versions");
  return templateHref(templateId, { panes, row: sourceRow });
}

function categoryLabel(category: Comment["category"]): string {
  if (category === -1) return "Low";
  if (category === 0) return "Medium";
  if (category === 1) return "High";
  return "None";
}

function defaultLabel(comment: Comment): string {
  if (comment.answerType === "boolean") {
    if (comment.defaultBoolean === true) return "True";
    if (comment.defaultBoolean === false) return "False";
    return "None";
  }
  if (comment.defaultText === null || comment.defaultText === "") return "None";
  return comment.defaultText;
}
