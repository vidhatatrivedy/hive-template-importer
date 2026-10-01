"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type Ref } from "react";
import { saveErrorMessage } from "@/core/import/editor-messages";
import type { Comment, EditableTree, Item, Section } from "@/core/import/schemas";
import { ADDED_IN_THE_EDITOR } from "@/app/editor/added-in-the-editor";
import {
  blankNames,
  canSave as canSaveState,
  commentGroups,
  editorReducer,
  initialEditorState,
  isDirty,
  isSavingOrAwaiting,
  locate,
  type Column,
  type EditorState,
} from "@/app/editor/editor-state";
import { templateHref } from "@/app/template-view";
import { confirmDiscard, GuardedLink, useReportUnsaved } from "@/app/unsaved-guard";
import { buttonClass, labelClass, primaryButtonClass, rowActiveClass, rowIdleClass } from "@/app/ui/classes";
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
  const router = useRouter();
  /** Row buttons of every level, by node id, for scrolling a selection or a blank name into view. */
  const [rowNodes] = useState(() => new Map<string, HTMLButtonElement>());
  const nameInput = useRef<HTMLInputElement>(null);
  /** Stops a second Save before the reducer has moved to `saving`. */
  const saveLock = useRef(false);
  const dirty = isDirty(state);
  const savingOrAwaiting = isSavingOrAwaiting(state);
  const canSave = canSaveState(state);
  const canDiscard = dirty && !savingOrAwaiting;
  useReportUnsaved(dirty);

  useEffect(() => {
    if (versionId === loadedVersion.current) return;
    loadedVersion.current = versionId;
    dispatch({ type: "serverVersion", versionId, number: versionNumber, tree });
  }, [versionId, versionNumber, tree]);

  async function runDiscard() {
    if (!canDiscard) return;
    if (!(await confirmDiscard())) return;
    dispatch({ type: "discard" });
  }

  async function runSave() {
    if (saveLock.current || !canSave) return;
    dispatch({ type: "saveRequested" });
    // Blank names stop the Save at `invalid`; nothing goes to the server.
    if (blankNames(state.tree).length > 0) return;
    saveLock.current = true;
    const baseNumber = state.base.number;
    const working = state.tree;
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

  // No dependency list: each render closes over the latest Save, so Ctrl/Cmd+S cannot go stale.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void runSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (row === loadedRow.current) return;
    loadedRow.current = row;
    if (row !== null) dispatch({ type: "selectRow", row });
  }, [row]);

  useEffect(() => {
    if (row === null || state.rowMiss !== null) return;
    const commentId = state.selection.commentId;
    if (!commentId) return;
    rowNodes.get(commentId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [row, rowNodes, state.rowMiss, state.selection.commentId]);

  // A Comment's name is edited in the detail; a Section's or Item's row is the closest thing to a name field.
  useEffect(() => {
    const id = state.focusName;
    if (!id) return;
    const rowNode = rowNodes.get(id);
    rowNode?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (id === state.selection.commentId) nameInput.current?.focus();
    else rowNode?.focus();
    dispatch({ type: "nameFocused" });
  }, [rowNodes, state.focusName, state.selection.commentId]);

  function runLoadLatest(latestNumber: number) {
    dispatch({ type: "loadLatest", number: latestNumber });
    router.refresh();
  }

  const markBlank = state.save.status === "invalid";
  const blank = useMemo(
    () => (markBlank ? new Set(blankNames(state.tree).map((ref) => ref.id)) : new Set<string>()),
    [markBlank, state.tree],
  );
  const notice = saveNotice(state, blank.size);

  const { section, item, comment } = locate(state.tree, state.selection);
  const focusColumn = (column: Column) => dispatch({ type: "focus", column });
  const indicator = saveIndicator(state);

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
        {canDiscard ? (
          <button type="button" className={`${buttonClass} shrink-0`} onClick={() => void runDiscard()}>
            Discard
          </button>
        ) : null}
        {children}
      </header>
      {notice ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 py-2 dark:border-white/[0.06]">
          <p role="alert" className="min-w-0 flex-1">
            {notice.message}
          </p>
          {notice.action === "load-latest" ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => runLoadLatest(notice.latestNumber)}
            >
              Load latest
            </button>
          ) : null}
          {notice.action === "dismiss" ? (
            <button type="button" className={buttonClass} onClick={() => dispatch({ type: "dismissError" })}>
              Dismiss
            </button>
          ) : null}
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
                    buttonRef={rowRef(rowNodes, id)}
                    onClick={() => dispatch({ type: "select", ref: { level: "section", id } })}
                  >
                    <RowName name={candidate.name} blank={blank.has(id)} />
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
                    buttonRef={rowRef(rowNodes, id)}
                    onClick={() => dispatch({ type: "select", ref: { level: "item", id } })}
                  >
                    <RowName name={candidate.name} blank={blank.has(id)} />
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
                            buttonRef={rowRef(rowNodes, id)}
                            onClick={() => dispatch({ type: "select", ref: { level: "comment", id } })}
                          >
                            <CommentTypeDot commentType={candidate.commentType} />
                            <AnswerTypeGlyph answerType={candidate.answerType} />
                            <RowName name={candidate.name} blank={blank.has(id)} />
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
            nameLocked={savingOrAwaiting}
            nameBlank={comment?.id ? blank.has(comment.id) : false}
            nameRef={nameInput}
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
  nameBlank,
  nameRef,
  onName,
}: {
  rowMiss: number | null;
  templateId: string;
  versionsOpen: boolean;
  section: Section | null;
  item: Item | null;
  comment: Comment | null;
  nameLocked: boolean;
  nameBlank: boolean;
  nameRef: Ref<HTMLInputElement>;
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
      nameBlank={nameBlank}
      nameRef={nameRef}
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
  nameBlank,
  nameRef,
  onName,
}: {
  templateId: string;
  versionsOpen: boolean;
  sectionName: string;
  itemName: string;
  comment: Comment;
  nameLocked: boolean;
  nameBlank: boolean;
  nameRef: Ref<HTMLInputElement>;
  onName: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-neutral-500">
          {sectionName} / {itemName}
        </p>
        {comment.sourceRow !== null ? (
          <GuardedLink
            href={commentSourceHref(templateId, versionsOpen, comment.sourceRow)}
            className="shrink-0 underline underline-offset-2"
          >
            Source row {comment.sourceRow}
          </GuardedLink>
        ) : (
          <p className="max-w-56 text-right text-neutral-400">{ADDED_IN_THE_EDITOR}</p>
        )}
      </div>
      <div>
        <input
          ref={nameRef}
          aria-label="Name"
          aria-invalid={nameBlank || undefined}
          value={comment.name}
          readOnly={nameLocked}
          onChange={(event) => onName(event.currentTarget.value)}
          className="w-full rounded-md border border-transparent bg-transparent px-1 text-[15px] font-medium text-neutral-900 outline-none hover:border-black/10 focus:border-black/20 aria-invalid:border-red-500/60 dark:text-white dark:hover:border-white/15 dark:focus:border-white/25"
        />
        {nameBlank ? <p className="px-1 text-red-600 dark:text-red-400">{BLANK_NAME}</p> : null}
      </div>
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
        selected ? rowActiveClass : rowIdleClass
      }`}
    >
      {children}
    </button>
  );
}

const BLANK_NAME = "Name is empty.";

/** A row's name, or the blank-name error in its place once a Save has been refused for it. */
function RowName({ name, blank }: { name: string; blank: boolean }) {
  if (blank) return <span className="min-w-0 flex-1 truncate text-red-600 dark:text-red-400">{BLANK_NAME}</span>;
  return <span className="min-w-0 flex-1 truncate">{name}</span>;
}

function rowRef(nodes: Map<string, HTMLButtonElement>, id: string): (node: HTMLButtonElement | null) => void {
  return (node) => {
    if (node) nodes.set(id, node);
    else nodes.delete(id);
  };
}

type SaveNotice = { message: string } & (
  | { action: "load-latest"; latestNumber: number }
  | { action: "dismiss" }
  | { action: null }
);

/** The bar under the header: a refused Save's message with what to do next, or the blank-name count. */
function saveNotice(state: EditorState, blankCount: number): SaveNotice | null {
  if (state.save.status === "invalid") {
    if (blankCount === 0) return null;
    return { message: saveErrorMessage({ kind: "names-blank", count: blankCount }), action: null };
  }
  if (state.save.status !== "refused") return null;
  const error = state.save.error;
  const message = saveErrorMessage(error);
  if (error.kind === "stale-base") return { message, action: "load-latest", latestNumber: error.latestNumber };
  return { message, action: "dismiss" };
}

function saveIndicator(state: EditorState): string | null {
  if (isSavingOrAwaiting(state)) return "Saving…";
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
