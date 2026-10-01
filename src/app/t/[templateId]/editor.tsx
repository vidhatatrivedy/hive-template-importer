"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type Ref } from "react";
import { saveErrorMessage } from "@/core/import/editor-messages";
import { summariseCuts, type TextChange } from "@/core/import/prepare-save";
import type { Comment, EditableTree, Item, Section } from "@/core/import/schemas";
import { sanitiseCommentHtml } from "@/core/sanitise";
import { ADDED_IN_THE_EDITOR } from "@/app/editor/added-in-the-editor";
import {
  blankNames,
  canChangeStructure,
  canMove,
  canSave as canSaveState,
  commentGroups,
  deleteSectionPrompt,
  editorReducer,
  initialEditorState,
  isDirty,
  isSavingOrAwaiting,
  locate,
  recommendationChoices,
  sectionContents,
  type Column,
  type CommentPatch,
  type EditorAction,
  type EditorMode,
  type EditorState,
  type NodeRef,
  type OptionChange,
} from "@/app/editor/editor-state";
import { templateHref } from "@/app/template-view";
import { confirmChoice, ConfirmDialog, confirmDiscard, GuardedLink, useReportUnsaved } from "@/app/unsaved-guard";
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

const COMMENT_TYPES = ["info", "limit", "defect"] as const satisfies readonly Comment["commentType"][];
const ANSWER_TYPES = [
  "boolean",
  "checkbox",
  "number",
  "range",
  "text",
  "date",
] as const satisfies readonly Comment["answerType"][];

const COMMENT_TYPE_OPTIONS = COMMENT_TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type] }));
const ANSWER_TYPE_OPTIONS = ANSWER_TYPES.map((type) => ({ value: type, label: ANSWER_LABEL[type] }));

const CHOICE_PREFIX = "choice:";
const OPTION_PREFIX = "option-";

type PatchHandler = (patch: CommentPatch) => void;
type OptionHandler = (change: OptionChange) => void;

const CATEGORY_CHOICES: { value: string; category: Comment["category"]; label: string }[] = [
  { value: "none", category: null, label: "None" },
  { value: "-1", category: -1, label: "Low" },
  { value: "0", category: 0, label: "Medium" },
  { value: "1", category: 1, label: "High" },
];

const DEFAULT_CLEARED = "Default cleared: its option was removed.";
const COMMA_OPTION = "Spectora couldn't export an option with a comma.";
const NEEDS_OPTION = "A multiple-choice Comment needs at least one option.";

const controlClass =
  "w-full rounded-md border border-black/[0.08] bg-white/60 px-1.5 py-1 dark:border-white/[0.1] dark:bg-neutral-900/60 disabled:opacity-60";

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
  mode = "edit",
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
  mode?: EditorMode;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    editorReducer,
    { versionId, number: versionNumber, tree, row, mode },
    initialEditorState,
  );
  const loadedVersion = useRef(versionId);
  const loadedRow = useRef(row);
  const router = useRouter();
  /** Rows of every level, by node id, for scrolling a selection or a blank name into view. */
  const [rowNodes] = useState(() => new Map<string, HTMLElement>());
  const nameInput = useRef<HTMLInputElement>(null);
  /** Stops a second Save before the reducer has moved to `saving`. */
  const saveLock = useRef(false);
  const dirty = isDirty(state);
  const savingOrAwaiting = isSavingOrAwaiting(state);
  const canSave = canSaveState(state);
  const canDiscard = dirty && !savingOrAwaiting;
  const editable = canChangeStructure(state);
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

  /** Deletes straight away, except a Section with Items in it, which asks first. Discard is the undo. */
  async function runDelete(ref: NodeRef) {
    if (ref.level === "section") {
      const contents = sectionContents(state.tree, ref.id);
      const name = state.tree.sections.find((candidate) => candidate.id === ref.id)?.name.trim() || "this Section";
      if (contents && contents.items > 0) {
        const accepted = await confirmChoice({
          message: deleteSectionPrompt(name, contents),
          confirmLabel: "Delete",
          cancelLabel: "Keep",
        });
        if (!accepted) return;
      }
    }
    dispatch({ type: "delete", ref });
  }

  async function runSave() {
    if (saveLock.current || !canSave) return;
    const next = editorReducer(state, { type: "saveRequested" });
    dispatch({ type: "saveRequested" });
    if (next.save.status !== "saving") return;
    await commitSave(state.base.number, state.tree);
  }

  async function acceptSave() {
    if (saveLock.current || state.save.status !== "confirm") return;
    const baseNumber = state.base.number;
    const working = state.tree;
    dispatch({ type: "saveConfirmed" });
    await commitSave(baseNumber, working);
  }

  function openConfirmedChange(path: TextChange["path"]) {
    const comment = state.tree.sections[path[0]]?.items[path[1]]?.comments[path[2]];
    if (comment?.id) dispatch({ type: "select", ref: { level: "comment", id: comment.id } });
    dispatch({ type: "saveCancelled" });
  }

  async function commitSave(baseNumber: number, working: EditableTree) {
    saveLock.current = true;
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

  // A Comment's name is edited in the detail; a selected Section's or Item's row is its name field.
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

  const recommendations = useMemo(() => recommendationChoices(state.tree), [state.tree]);
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
          actions={
            editable ? (
              <NodeActions
                noun="Section"
                state={state}
                selected={section?.id ? { level: "section", id: section.id } : null}
                canAdd
                onAdd={() => dispatch({ type: "addSection" })}
                dispatch={dispatch}
                onDelete={(ref) => void runDelete(ref)}
              />
            ) : null
          }
        >
          <ul>
            {state.tree.sections.map((candidate) => {
              const id = candidate.id;
              if (!id) return null;
              if (editable && id === state.selection.sectionId) {
                return (
                  <li key={id}>
                    <NameRow
                      label="Section name"
                      name={candidate.name}
                      blank={blank.has(id)}
                      inputRef={rowRef(rowNodes, id)}
                      onName={(name) => dispatch({ type: "rename", ref: { level: "section", id }, name })}
                    />
                  </li>
                );
              }
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
          actions={
            editable ? (
              <NodeActions
                noun="Item"
                state={state}
                selected={item?.id ? { level: "item", id: item.id } : null}
                canAdd={section !== null}
                onAdd={() => dispatch({ type: "addItem" })}
                dispatch={dispatch}
                onDelete={(ref) => void runDelete(ref)}
              />
            ) : null
          }
        >
          <ul>
            {section?.items.map((candidate) => {
              const id = candidate.id;
              if (!id) return null;
              const count = <CommentCount count={candidate.comments.length} />;
              if (editable && id === state.selection.itemId) {
                return (
                  <li key={id}>
                    <NameRow
                      label="Item name"
                      name={candidate.name}
                      blank={blank.has(id)}
                      inputRef={rowRef(rowNodes, id)}
                      onName={(name) => dispatch({ type: "rename", ref: { level: "item", id }, name })}
                    >
                      {count}
                    </NameRow>
                  </li>
                );
              }
              return (
                <li key={id}>
                  <RowButton
                    selected={id === state.selection.itemId}
                    title={candidate.name}
                    buttonRef={rowRef(rowNodes, id)}
                    onClick={() => dispatch({ type: "select", ref: { level: "item", id } })}
                  >
                    <RowName name={candidate.name} blank={blank.has(id)} />
                    {count}
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
          actions={
            editable ? (
              <NodeActions
                noun="Comment"
                state={state}
                selected={comment?.id ? { level: "comment", id: comment.id } : null}
                dispatch={dispatch}
                onDelete={(ref) => void runDelete(ref)}
              />
            ) : null
          }
        >
          {item || editable
            ? commentGroups(item?.comments ?? [], { includeEmpty: editable }).map((group) => (
                <div key={group.label}>
                  <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
                    <h3 className={labelClass}>{group.label}</h3>
                    {editable ? (
                      <AddButton
                        label={`New ${TYPE_LABEL[group.type]} Comment`}
                        disabled={item === null}
                        onClick={() => dispatch({ type: "addComment", commentType: group.type })}
                      />
                    ) : null}
                  </div>
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
            readOnly={state.mode === "read-only"}
            locked={savingOrAwaiting}
            nameBlank={comment?.id ? blank.has(comment.id) : false}
            nameRef={nameInput}
            recommendations={recommendations}
            defaultCleared={state.note?.commentId === comment?.id}
            onName={(name) => {
              if (!comment?.id) return;
              dispatch({ type: "setComment", id: comment.id, patch: { name } });
            }}
            onPatch={(patch) => {
              if (!comment?.id) return;
              dispatch({ type: "setComment", id: comment.id, patch });
            }}
            onOption={(change) => {
              if (!comment?.id) return;
              dispatch({ type: "option", id: comment.id, ...change });
            }}
          />
        </section>
      </div>
      {state.save.status === "confirm" ? (
        <TextChangeDialog
          tree={state.tree}
          changes={state.save.changes}
          onSave={() => void acceptSave()}
          onCancel={() => dispatch({ type: "saveCancelled" })}
          onOpen={openConfirmedChange}
        />
      ) : null}
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
  readOnly,
  locked,
  nameBlank,
  nameRef,
  recommendations,
  defaultCleared,
  onName,
  onPatch,
  onOption,
}: {
  rowMiss: number | null;
  templateId: string;
  versionsOpen: boolean;
  section: Section | null;
  item: Item | null;
  comment: Comment | null;
  readOnly: boolean;
  locked: boolean;
  nameBlank: boolean;
  nameRef: Ref<HTMLInputElement>;
  recommendations: readonly string[];
  defaultCleared: boolean;
  onName: (name: string) => void;
  onPatch: PatchHandler;
  onOption: OptionHandler;
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
      readOnly={readOnly}
      locked={locked}
      nameBlank={nameBlank}
      nameRef={nameRef}
      recommendations={recommendations}
      defaultCleared={defaultCleared}
      onName={onName}
      onPatch={onPatch}
      onOption={onOption}
    />
  );
}

function CommentDetail({
  templateId,
  versionsOpen,
  sectionName,
  itemName,
  comment,
  readOnly,
  locked,
  nameBlank,
  nameRef,
  recommendations,
  defaultCleared,
  onName,
  onPatch,
  onOption,
}: {
  templateId: string;
  versionsOpen: boolean;
  sectionName: string;
  itemName: string;
  comment: Comment;
  readOnly: boolean;
  locked: boolean;
  nameBlank: boolean;
  nameRef: Ref<HTMLInputElement>;
  recommendations: readonly string[];
  defaultCleared: boolean;
  onName: (name: string) => void;
  onPatch: PatchHandler;
  onOption: OptionHandler;
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
        {readOnly ? (
          <p className="px-1 text-[15px] font-medium text-neutral-900 dark:text-white">{comment.name}</p>
        ) : (
          <input
            ref={nameRef}
            aria-label="Name"
            aria-invalid={nameBlank || undefined}
            value={comment.name}
            readOnly={locked}
            onChange={(event) => onName(event.currentTarget.value)}
            className="w-full rounded-md border border-transparent bg-transparent px-1 text-[15px] font-medium text-neutral-900 outline-none hover:border-black/10 focus:border-black/20 aria-invalid:border-red-500/60 dark:text-white dark:hover:border-white/15 dark:focus:border-white/25"
          />
        )}
        {nameBlank ? <p className="px-1 text-red-600 dark:text-red-400">{BLANK_NAME}</p> : null}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <ChoiceField
          readOnly={readOnly}
          label="Type"
          display={TYPE_LABEL[comment.commentType]}
          value={comment.commentType}
          locked={locked}
          options={COMMENT_TYPE_OPTIONS}
          onChange={(value) => {
            if (isCommentType(value)) onPatch({ commentType: value });
          }}
        />
        <ChoiceField
          readOnly={readOnly}
          label="Answer"
          display={ANSWER_LABEL[comment.answerType]}
          value={comment.answerType}
          locked={locked}
          options={ANSWER_TYPE_OPTIONS}
          onChange={(value) => {
            if (isAnswerType(value)) onPatch({ answerType: value });
          }}
        />
        {comment.commentType === "defect" ? (
          <ChoiceField
            readOnly={readOnly}
            label="Category"
            display={categoryLabel(comment.category)}
            value={categorySelectValue(comment.category)}
            locked={locked}
            options={CATEGORY_CHOICES}
            onChange={(value) => {
              const choice = CATEGORY_CHOICES.find((candidate) => candidate.value === value);
              if (choice) onPatch({ category: choice.category });
            }}
          />
        ) : null}
        <RecommendationField
          comment={comment}
          choices={recommendations}
          readOnly={readOnly}
          locked={locked}
          onPatch={onPatch}
        />
      </div>
      {comment.answerType === "checkbox" ? (
        <OptionsField comment={comment} readOnly={readOnly} locked={locked} onOption={onOption} />
      ) : null}
      <DefaultField comment={comment} readOnly={readOnly} locked={locked} defaultCleared={defaultCleared} onPatch={onPatch} />
      <CommentText
        key={comment.id}
        comment={comment}
        readOnly={readOnly}
        locked={locked}
        onPatch={onPatch}
      />
    </div>
  );
}

/** Rendered Comment text, or the HTML source beside a live preview of what Save would store. */
function CommentText({
  comment,
  readOnly,
  locked,
  onPatch,
}: {
  comment: Comment;
  readOnly: boolean;
  locked: boolean;
  onPatch: PatchHandler;
}) {
  const [editing, setEditing] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const showSource = editing && !readOnly;
  useEffect(() => {
    if (showSource) sourceRef.current?.focus();
  }, [showSource]);
  const preview = useMemo(
    () => (showSource ? sanitiseCommentHtml(comment.textHtml) : null),
    [showSource, comment.textHtml],
  );
  const cuts = preview && preview.cuts.length > 0 ? summariseCuts(preview.cuts) : [];
  const plain = !comment.textHtml.includes("<");

  return (
    <div className="border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
      {readOnly ? null : (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className={buttonClass}
            disabled={locked && !showSource}
            onClick={() => setEditing((open) => !open)}
          >
            {showSource ? "Done" : "Edit"}
          </button>
        </div>
      )}
      {showSource && preview ? (
        <div className="grid grid-cols-2 gap-3">
          <textarea
            ref={sourceRef}
            aria-label={plain ? "Comment text" : "HTML source"}
            value={comment.textHtml}
            readOnly={locked}
            spellCheck={plain}
            onChange={(event) => onPatch({ textHtml: event.currentTarget.value })}
            className={`${controlClass} min-h-40 resize-y ${plain ? "" : "font-mono"}`}
          />
          <div className="min-w-0">
            <CommentHtml html={preview.html} sourceRow={comment.sourceRow} />
            {cuts.length > 0 ? (
              <div className="mt-3 text-neutral-500">
                <p>When saved, this will be removed:</p>
                <ul className="mt-1 list-disc pl-4">
                  {cuts.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <CommentHtml html={comment.textHtml} sourceRow={comment.sourceRow} />
      )}
    </div>
  );
}

function TextChangeDialog({
  tree,
  changes,
  onSave,
  onCancel,
  onOpen,
}: {
  tree: EditableTree;
  changes: readonly TextChange[];
  onSave: () => void;
  onCancel: () => void;
  onOpen: (path: TextChange["path"]) => void;
}) {
  return (
    <ConfirmDialog
      message="When saved, this will be removed:"
      confirmLabel="Save anyway"
      cancelLabel="Keep editing"
      onConfirm={onSave}
      onCancel={onCancel}
    >
      <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        {changes.map((change) => (
          <li key={change.path.join(".")}>
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              onClick={() => onOpen(change.path)}
            >
              <span className="text-neutral-900 dark:text-white">{changeTitle(tree, change)}</span>
              <ul className="mt-1 text-neutral-500">
                {change.summary.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </button>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

function changeTitle(tree: EditableTree, change: TextChange): string {
  const section = tree.sections[change.path[0]];
  const item = section?.items[change.path[1]];
  return `${section?.name.trim() || "Section"} › ${item?.name.trim() || "Item"} › ${change.name || "Comment"}`;
}

function RecommendationField({
  comment,
  choices,
  readOnly,
  locked,
  onPatch,
}: {
  comment: Comment;
  choices: readonly string[];
  readOnly: boolean;
  locked: boolean;
  onPatch: PatchHandler;
}) {
  if (readOnly) return <Field label="Recommendation" value={comment.recommendation ?? "None"} />;
  return <RecommendationEditor key={comment.id} comment={comment} choices={choices} locked={locked} onPatch={onPatch} />;
}

/** "Other…" is local: a Recommendation typed here joins the list once it is stored. */
function RecommendationEditor({
  comment,
  choices,
  locked,
  onPatch,
}: {
  comment: Comment;
  choices: readonly string[];
  locked: boolean;
  onPatch: PatchHandler;
}) {
  const [editingOther, setEditingOther] = useState(false);
  const otherInput = useRef<HTMLInputElement>(null);
  const value = recommendationSelectValue(editingOther, comment.recommendation);

  useEffect(() => {
    if (editingOther) otherInput.current?.focus();
  }, [editingOther]);

  function choose(next: string) {
    if (next === "none") {
      setEditingOther(false);
      onPatch({ recommendation: null });
      return;
    }
    if (next === "other") {
      setEditingOther(true);
      if (!editingOther && comment.recommendation !== null) onPatch({ recommendation: null });
      return;
    }
    if (next.startsWith(CHOICE_PREFIX)) {
      setEditingOther(false);
      onPatch({ recommendation: next.slice(CHOICE_PREFIX.length) });
    }
  }

  return (
    <div className="min-w-0">
      <LabeledSelect label="Recommendation" value={value} disabled={locked} onChange={choose}>
        <option value="none">None</option>
        {choices.map((choice) => (
          <option key={choice} value={`${CHOICE_PREFIX}${choice}`}>
            {choice}
          </option>
        ))}
        <option value="other">Other…</option>
      </LabeledSelect>
      {editingOther ? (
        <input
          ref={otherInput}
          aria-label="Other recommendation"
          value={comment.recommendation ?? ""}
          disabled={locked}
          onChange={(event) => onPatch({ recommendation: emptyToNull(event.currentTarget.value) })}
          className={`${controlClass} mt-1`}
        />
      ) : null}
    </div>
  );
}

function OptionsField({
  comment,
  readOnly,
  locked,
  onOption,
}: {
  comment: Comment;
  readOnly: boolean;
  locked: boolean;
  onOption: OptionHandler;
}) {
  return (
    <div>
      <div className={labelClass}>Options</div>
      {readOnly ? (
        <OptionPills options={comment.choiceOptions} />
      ) : (
        <OptionEditor comment={comment} locked={locked} onOption={onOption} />
      )}
      {readOnly && comment.choiceOptions.some((option) => option.includes(",")) ? (
        <p className="mt-1 text-neutral-500">{COMMA_OPTION}</p>
      ) : null}
      {readOnly && everyOptionBlank(comment.choiceOptions) ? (
        <p className="mt-1 text-neutral-500">{NEEDS_OPTION}</p>
      ) : null}
    </div>
  );
}

function OptionPills({ options }: { options: readonly string[] }) {
  if (options.length === 0) return <p className="mt-1 text-neutral-500">None</p>;
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {options.map((option, index) => (
        <li key={`${index}-${option}`} className="rounded-full border border-black/10 px-2 py-0.5 dark:border-white/10">
          {option}
        </li>
      ))}
    </ul>
  );
}

function OptionEditor({
  comment,
  locked,
  onOption,
}: {
  comment: Comment;
  locked: boolean;
  onOption: OptionHandler;
}) {
  const pendingFocus = useRef(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    inputs.current[comment.choiceOptions.length - 1]?.focus();
  }, [comment.choiceOptions]);

  return (
    <>
      <ul className="mt-1 flex flex-col gap-1">
        {comment.choiceOptions.map((option, index) => (
          <li key={index}>
            <div className="flex items-center gap-1">
              <input
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                aria-label={`Option ${index + 1}`}
                value={option}
                disabled={locked}
                onChange={(event) => onOption({ op: "edit", index, value: event.currentTarget.value })}
                className={`${controlClass} min-w-0 flex-1`}
              />
              <IconButton
                label="Move option up"
                disabled={locked || index === 0}
                onClick={() => onOption({ op: "up", index })}
              >
                ↑
              </IconButton>
              <IconButton
                label="Move option down"
                disabled={locked || index === comment.choiceOptions.length - 1}
                onClick={() => onOption({ op: "down", index })}
              >
                ↓
              </IconButton>
              <IconButton label="Remove option" disabled={locked} onClick={() => onOption({ op: "remove", index })}>
                ✕
              </IconButton>
            </div>
            {option.includes(",") ? <p className="text-neutral-500">{COMMA_OPTION}</p> : null}
          </li>
        ))}
      </ul>
      {everyOptionBlank(comment.choiceOptions) ? <p className="mt-1 text-neutral-500">{NEEDS_OPTION}</p> : null}
      <button
        type="button"
        disabled={locked}
        onClick={() => {
          pendingFocus.current = true;
          onOption({ op: "add" });
        }}
        className="mt-1 text-[11px] text-neutral-500 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40 dark:hover:text-white"
      >
        + option
      </button>
    </>
  );
}

function DefaultField({
  comment,
  readOnly,
  locked,
  defaultCleared,
  onPatch,
}: {
  comment: Comment;
  readOnly: boolean;
  locked: boolean;
  defaultCleared: boolean;
  onPatch: PatchHandler;
}) {
  return (
    <div className="max-w-xs">
      <DefaultControl comment={comment} readOnly={readOnly} locked={locked} onPatch={onPatch} />
      {defaultCleared ? <p className="mt-1 text-neutral-500">{DEFAULT_CLEARED}</p> : null}
    </div>
  );
}

function DefaultControl({
  comment,
  readOnly,
  locked,
  onPatch,
}: {
  comment: Comment;
  readOnly: boolean;
  locked: boolean;
  onPatch: PatchHandler;
}) {
  if (readOnly) return <Field label="Default" value={defaultLabel(comment)} />;
  if (comment.answerType === "boolean") {
    return (
      <LabeledSelect
        label="Default"
        value={booleanSelectValue(comment.defaultBoolean)}
        disabled={locked}
        onChange={(value) => onPatch({ defaultBoolean: booleanFromSelect(value) })}
      >
        <option value="none">None</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </LabeledSelect>
    );
  }
  if (comment.answerType === "checkbox") {
    return <CheckboxDefault comment={comment} locked={locked} onPatch={onPatch} />;
  }
  return (
    <label className="block max-w-xs">
      <span className={labelClass}>Default</span>
      <input
        aria-label="Default"
        value={comment.defaultText ?? ""}
        disabled={locked}
        onChange={(event) => onPatch({ defaultText: emptyToNull(event.currentTarget.value) })}
        className={`${controlClass} mt-1`}
      />
    </label>
  );
}

function CheckboxDefault({
  comment,
  locked,
  onPatch,
}: {
  comment: Comment;
  locked: boolean;
  onPatch: PatchHandler;
}) {
  const match = comment.defaultText === null ? -1 : comment.choiceOptions.indexOf(comment.defaultText);
  const orphan = comment.defaultText !== null && match < 0;

  return (
    <LabeledSelect
      label="Default"
      value={checkboxDefaultSelectValue(comment.defaultText, match)}
      disabled={locked}
      onChange={(next) => applyCheckboxDefault(next, comment.choiceOptions, onPatch)}
    >
      <option value="none">None</option>
      {comment.choiceOptions.map((option, index) => (
        <option key={index} value={`${OPTION_PREFIX}${index}`}>
          {option === "" ? "(blank)" : option}
        </option>
      ))}
      {orphan ? <option value="orphan">{comment.defaultText} (not an option)</option> : null}
    </LabeledSelect>
  );
}

function LabeledSelect({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="min-w-0">
      <span className={labelClass}>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`${controlClass} mt-1`}
      >
        {children}
      </select>
    </label>
  );
}

function isCommentType(value: string): value is Comment["commentType"] {
  return COMMENT_TYPES.some((type) => type === value);
}

function isAnswerType(value: string): value is Comment["answerType"] {
  return ANSWER_TYPES.some((type) => type === value);
}

function ChoiceField({
  readOnly,
  label,
  display,
  value,
  locked,
  options,
  onChange,
}: {
  readOnly: boolean;
  label: string;
  display: string;
  value: string;
  locked: boolean;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  if (readOnly) return <Field label={label} value={display} />;
  return (
    <LabeledSelect label={label} value={value} disabled={locked} onChange={onChange}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </LabeledSelect>
  );
}

function categorySelectValue(category: Comment["category"]): string {
  if (category === null) return "none";
  return String(category);
}

function recommendationSelectValue(editingOther: boolean, recommendation: string | null): string {
  if (editingOther) return "other";
  if (recommendation === null) return "none";
  return `${CHOICE_PREFIX}${recommendation}`;
}

function emptyToNull(value: string): string | null {
  if (value === "") return null;
  return value;
}

function everyOptionBlank(options: readonly string[]): boolean {
  return options.every((option) => option.trim() === "");
}

function booleanSelectValue(value: boolean | null): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "none";
}

function booleanFromSelect(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function checkboxDefaultSelectValue(defaultText: string | null, match: number): string {
  if (defaultText === null) return "none";
  if (match < 0) return "orphan";
  return `${OPTION_PREFIX}${match}`;
}

function applyCheckboxDefault(next: string, options: readonly string[], onPatch: PatchHandler) {
  if (next === "none") {
    onPatch({ defaultText: null });
    return;
  }
  if (!next.startsWith(OPTION_PREFIX)) return;
  const option = options[Number(next.slice(OPTION_PREFIX.length))];
  if (option !== undefined) onPatch({ defaultText: option });
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
  actions,
  children,
}: {
  title: string;
  collapsed: boolean;
  stripText: string;
  onFocus: () => void;
  actions?: ReactNode;
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
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className={labelClass}>{title}</h2>
        {actions}
      </div>
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

/** The column header's controls: "+ New" (when the column adds nodes), and move and delete for its selected node. */
function NodeActions({
  noun,
  state,
  selected,
  canAdd,
  onAdd,
  dispatch,
  onDelete,
}: {
  noun: "Section" | "Item" | "Comment";
  state: EditorState;
  selected: NodeRef | null;
  canAdd?: boolean;
  onAdd?: () => void;
  dispatch: (action: EditorAction) => void;
  onDelete: (ref: NodeRef) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {selected ? (
        <>
          <IconButton
            label={`Move ${noun} up`}
            disabled={!canMove(state, selected, "up")}
            onClick={() => dispatch({ type: "move", ref: selected, dir: "up" })}
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move ${noun} down`}
            disabled={!canMove(state, selected, "down")}
            onClick={() => dispatch({ type: "move", ref: selected, dir: "down" })}
          >
            ↓
          </IconButton>
          <IconButton label={`Delete ${noun}`} onClick={() => onDelete(selected)}>
            ✕
          </IconButton>
        </>
      ) : null}
      {onAdd ? <AddButton label={`New ${noun}`} disabled={!canAdd} onClick={onAdd} /> : null}
    </div>
  );
}

function AddButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 rounded px-1 text-[11px] text-neutral-500 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40 dark:hover:text-white"
    >
      + New
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-[11px] text-neutral-500 hover:bg-black/[0.04] hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-white"
    >
      {children}
    </button>
  );
}

/** The selected Section's or Item's row: its name, renamed in place. */
function NameRow({
  label,
  name,
  blank,
  inputRef,
  onName,
  children,
}: {
  label: string;
  name: string;
  blank: boolean;
  inputRef: Ref<HTMLInputElement>;
  onName: (name: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className={`flex w-full items-center gap-2 px-3 py-0.5 ${rowActiveClass}`}>
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={blank || undefined}
        placeholder={blank ? BLANK_NAME : "Name"}
        value={name}
        onChange={(event) => onName(event.currentTarget.value)}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 -mx-1 outline-none placeholder:text-neutral-400 focus:border-black/20 aria-invalid:border-red-500/60 aria-invalid:placeholder:text-red-600 dark:focus:border-white/25 dark:aria-invalid:placeholder:text-red-400"
      />
      {children}
    </div>
  );
}

function CommentCount({ count }: { count: number }) {
  return (
    <span className="shrink-0 tabular-nums text-neutral-400" aria-label={`${count} Comments`}>
      {count}
    </span>
  );
}

const BLANK_NAME = "Name is empty.";

/** A row's name, or the blank-name error in its place once a Save has been refused for it. */
function RowName({ name, blank }: { name: string; blank: boolean }) {
  if (blank) return <span className="min-w-0 flex-1 truncate text-red-600 dark:text-red-400">{BLANK_NAME}</span>;
  return <span className="min-w-0 flex-1 truncate">{name}</span>;
}

function rowRef(nodes: Map<string, HTMLElement>, id: string): (node: HTMLElement | null) => void {
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
  if (comment.answerType === "checkbox" && !comment.choiceOptions.includes(comment.defaultText)) {
    return `${comment.defaultText} (not an option)`;
  }
  return comment.defaultText;
}
