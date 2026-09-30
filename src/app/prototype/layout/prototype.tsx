"use client";
/* eslint-disable react-hooks/set-state-in-effect -- PROTOTYPE, throwaway */
// PROTOTYPE, throwaway. No persistence, no real mutations: edits are local state only.
// Data: first six Sections of the InterNACHI Residential fixture (sample.json).
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import sample from "./sample.json";

type Comment = {
  row: number;
  name: string;
  text: string;
  type: string;
  category: string | null;
  options: string | null;
  rec: string | null;
  answer: string;
  default: string | null;
};
type Item = { name: string; comments: Comment[] };
type Section = { name: string; items: Item[] };
type Variant = "A" | "B" | "C";

const sections = sample.sections as Section[];
const VARIANTS: { key: Variant; name: string }[] = [
  { key: "A", name: "Floating columns" },
  { key: "B", name: "Collapsing columns" },
  { key: "C", name: "Navigator · item document · inspector" },
];
const TEMPLATES = [
  { name: "InterNACHI Residential", meta: "Imported · v3", active: true },
  { name: "InterNACHI Residential (copy)", meta: "Copy · v1" },
  { name: "Radon Inspection", meta: "Imported · v1" },
  { name: "Room-by-Room Residential", meta: "Imported · v2" },
  { name: "Untitled Template", meta: "Blank · v1" },
];
const TYPE_LABEL: Record<string, string> = {
  info: "Information",
  limit: "Limitations",
  defect: "Defects",
};
const CATEGORY: Record<string, string> = { "-1": "Low", "0": "Med", "1": "High" };

// ---------- visual language ----------
const glass =
  "bg-white/55 dark:bg-neutral-900/55 backdrop-blur-2xl backdrop-saturate-150 border border-black/[0.07] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]";
const label = "text-[10px] uppercase tracking-[0.08em] text-neutral-400";
const row =
  "flex items-center gap-2 px-2.5 py-[5px] rounded-md cursor-default truncate";
const rowActive = "bg-black/[0.07] dark:bg-white/[0.1] text-neutral-900 dark:text-white";
const rowIdle = "text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.035] dark:hover:bg-white/[0.05]";
const btn =
  "h-6 px-2.5 rounded-md text-[11px] border border-black/[0.08] dark:border-white/[0.1] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]";
const btnPrimary =
  "h-6 px-2.5 rounded-md text-[11px] bg-neutral-900 text-white dark:bg-white dark:text-neutral-900";

function Backdrop({ children }: { children: ReactNode }) {
  // Soft monochrome blobs so the frosted glass has something to blur.
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-100 dark:bg-neutral-950 text-[12px] leading-[1.45] text-neutral-800 dark:text-neutral-200 font-[family-name:var(--font-geist-sans)]">
      <div className="pointer-events-none absolute -top-40 -left-20 h-[520px] w-[520px] rounded-full bg-neutral-300/70 dark:bg-neutral-700/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-200px] right-[-100px] h-[600px] w-[600px] rounded-full bg-neutral-400/40 dark:bg-neutral-800/60 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-[300px] w-[300px] rounded-full bg-white/80 dark:bg-neutral-600/20 blur-3xl" />
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

function TypeGlyph({ answer }: { answer: string }) {
  const g = { boolean: "✓", checkbox: "☰", number: "#", range: "↔", text: "T", date: "◷" }[answer] ?? "·";
  return <span className="w-3 text-center text-[10px] text-neutral-400 font-mono">{g}</span>;
}

function Dot({ type }: { type: string }) {
  const c = type === "defect" ? "bg-neutral-900 dark:bg-white" : type === "limit" ? "bg-neutral-500" : "border border-neutral-400";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
}

// ---------- shared state ----------
function useEditor() {
  const [s, setS] = useState(1);
  const [i, setI] = useState(1);
  const [c, setC] = useState(3);
  const [dirty, setDirty] = useState(false);
  const [trust, setTrust] = useState(false);
  const [versions, setVersions] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const section = sections[s];
  const item = section.items[Math.min(i, section.items.length - 1)];
  const comment = item.comments[Math.min(c, item.comments.length - 1)];
  return {
    s, i, c, section, item, comment, dirty, trust, versions, sidebar,
    pickS: (n: number) => { setS(n); setI(0); setC(0); },
    pickI: (n: number) => { setI(n); setC(0); },
    pickC: setC,
    touch: () => setDirty(true),
    save: () => setDirty(false),
    toggleTrust: () => setTrust((v) => !v),
    toggleVersions: () => setVersions((v) => !v),
    toggleSidebar: () => setSidebar((v) => !v),
  };
}
type Ed = ReturnType<typeof useEditor>;

function grouped(item: Item) {
  return (["info", "limit", "defect"] as const)
    .map((t) => ({ t, list: item.comments.map((c, idx) => ({ c, idx })).filter(({ c }) => c.type === t) }))
    .filter((g) => g.list.length);
}

// ---------- shared widgets (content, not layout) ----------
function HeaderActions({ ed }: { ed: Ed }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 flex items-center gap-1.5 text-[11px] text-neutral-400">
        {ed.dirty ? (<><span className="h-1.5 w-1.5 rounded-full bg-neutral-900 dark:bg-white" /> Unsaved changes</>) : "Version 3 · saved"}
      </span>
      {ed.dirty && <button className={btn} onClick={ed.save}>Discard</button>}
      <button className={btnPrimary} onClick={ed.save}>Save</button>
      <span className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" />
      <button className={`${btn} ${ed.trust ? rowActive : ""}`} onClick={ed.toggleTrust}>Trust Report</button>
      <button className={`${btn} ${ed.versions ? rowActive : ""}`} onClick={ed.toggleVersions}>Versions</button>
    </div>
  );
}

function TemplateList({ compact }: { compact?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {TEMPLATES.map((t) => (
        <div key={t.name} className={`${row} ${t.active ? rowActive : rowIdle} flex-col !items-start !gap-0`}>
          <span className="truncate w-full">{t.name}</span>
          {!compact && <span className="text-[10px] text-neutral-400">{t.meta}</span>}
        </div>
      ))}
    </div>
  );
}

function NewMenu() {
  return (
    <div className="flex gap-1">
      <button className={`${btn} flex-1`}>Import…</button>
      <button className={`${btn} flex-1`}>Blank</button>
    </div>
  );
}

function CommentDetail({ ed, dense }: { ed: Ed; dense?: boolean }) {
  const cm = ed.comment;
  const [text, setText] = useState(cm.text);
  useEffect(() => setText(cm.text), [cm]);
  const field = "w-full rounded-md bg-white/60 dark:bg-white/[0.04] border border-black/[0.07] dark:border-white/[0.08] px-2 py-1 outline-none focus:border-black/30 dark:focus:border-white/30";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className={label}>{ed.section.name} / {ed.item.name}</span>
        <span className="text-[10px] text-neutral-400 font-mono underline decoration-dotted cursor-pointer" title="Open Source row view">Source row {cm.row}</span>
      </div>
      <input className={`${field} text-[14px] font-medium`} defaultValue={cm.name} key={cm.row} onChange={ed.touch} />
      <div className={`grid ${dense ? "grid-cols-2" : "grid-cols-4"} gap-2`}>
        {[
          ["Type", ["info", "limit", "defect"], cm.type],
          ["Answer", ["boolean", "checkbox", "number", "range", "text", "date"], cm.answer],
          ["Category", ["—", "Low", "Med", "High"], cm.category ? CATEGORY[cm.category] : "—"],
          ["Recommendation", ["—", "pro", "roof", "plumber", "electrician", "hvac", "gc"], cm.rec ?? "—"],
        ].map(([l, opts, v]) => (
          <label key={l as string} className="flex flex-col gap-1">
            <span className={label}>{l as string}</span>
            <select className={field} defaultValue={v as string} key={cm.row + (l as string)} onChange={ed.touch}>
              {(opts as string[]).map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>
      {cm.options && (
        <div className="flex flex-col gap-1">
          <span className={label}>Options</span>
          <div className="flex flex-wrap gap-1">
            {cm.options.split(",").map((o) => (
              <span key={o} className="rounded-full border border-black/[0.08] dark:border-white/[0.1] px-2 py-0.5 text-[11px]">{o.trim()}</span>
            ))}
            <span className="rounded-full border border-dashed border-black/[0.15] px-2 py-0.5 text-[11px] text-neutral-400">+ option</span>
          </div>
        </div>
      )}
      <div className={`grid ${dense ? "grid-cols-1" : "grid-cols-2"} gap-2`}>
        <div className="flex flex-col gap-1">
          <span className={label}>Text · HTML source</span>
          <textarea
            className={`${field} font-mono text-[11px] min-h-[160px] resize-y`}
            value={text}
            onChange={(e) => { setText(e.target.value); ed.touch(); }}
            placeholder="(empty: this Comment is a field)"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>Preview</span>
          <div
            className="min-h-[160px] rounded-md border border-black/[0.05] dark:border-white/[0.06] px-3 py-2 text-[12.5px] leading-relaxed [&_p]:mb-2 [&_a]:underline [&_img]:max-w-full"
            // Prototype only: fixture HTML, not sanitised.
            dangerouslySetInnerHTML={{ __html: text || "<span style='color:#999'>No text</span>" }}
          />
        </div>
      </div>
    </div>
  );
}

function TrustPane() {
  const all = sample.allSections;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {[["Rows", sample.rows], ["Sections", all.length], ["Unexplained", 0]].map(([k, v]) => (
          <div key={k} className="rounded-md border border-black/[0.06] dark:border-white/[0.08] px-2 py-1.5">
            <div className={label}>{k}</div>
            <div className="text-[16px] font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500">Pinned to Version 1 (import). Every Source row accounted for.</div>
      <div>
        <div className={`${label} mb-1`}>Reconciliation</div>
        {all.map((s) => (
          <div key={s.name} className="flex items-center gap-2 py-[3px] border-b border-black/[0.04] dark:border-white/[0.05]">
            <span className="flex-1 truncate">{s.name}</span>
            <span className="tabular-nums text-neutral-400">{s.items} · {s.comments}</span>
            <span>✓</span>
          </div>
        ))}
      </div>
      <div>
        <div className={`${label} mb-1`}>Issues by kind</div>
        {[
          ["notice", "Changed", "Trimmed whitespace", 14],
          ["warning", "Unsupported", "Iframe replaced by link", 2],
          ["notice", "Kept but not used", "Default Estimate Min / Max", 392],
          ["notice", "Missing from export", "Ratings, attachments", 1],
        ].map(([sev, cls, kind, n]) => (
          <div key={kind as string} className="flex items-center gap-2 py-[3px]">
            <span className={`text-[10px] w-12 ${sev === "warning" ? "font-semibold" : "text-neutral-400"}`}>{sev}</span>
            <span className="flex-1 truncate">{kind}<span className="text-neutral-400"> · {cls}</span></span>
            <span className="tabular-nums text-neutral-400">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionsPane() {
  return (
    <div className="flex flex-col gap-0.5">
      {[
        ["Version 3", "Today 21:10", "current"],
        ["Version 2", "Today 20:42", ""],
        ["Version 1", "Today 20:15", "import"],
      ].map(([v, t, tag]) => (
        <div key={v} className={`${row} ${tag === "current" ? rowActive : rowIdle} justify-between`}>
          <span>{v} <span className="text-neutral-400">· {t}</span></span>
          {tag === "current" ? <span className="text-[10px] text-neutral-400">current</span> : <button className={btn}>View</button>}
        </div>
      ))}
      <div className="mt-2 text-[11px] text-neutral-400">Viewing an old Version is read-only. Restore creates Version 4.</div>
    </div>
  );
}

function ColList<T>({ items, active, onPick, render }: { items: T[]; active: number; onPick: (n: number) => void; render: (t: T) => ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      {items.map((t, n) => (
        <div key={n} className={`${row} ${n === active ? rowActive : rowIdle}`} onClick={() => onPick(n)}>{render(t)}</div>
      ))}
    </div>
  );
}

function CommentList({ ed }: { ed: Ed }) {
  return (
    <div className="flex flex-col gap-3">
      {grouped(ed.item).map((g) => (
        <div key={g.t}>
          <div className="flex items-center justify-between px-2.5 mb-1">
            <span className={label}>{TYPE_LABEL[g.t]}</span>
            <span className="text-[10px] text-neutral-400">+ New</span>
          </div>
          {g.list.map(({ c, idx }) => (
            <div key={idx} className={`${row} ${idx === ed.c ? rowActive : rowIdle}`} onClick={() => ed.pickC(idx)}>
              <TypeGlyph answer={c.answer} />
              <span className="truncate">{c.name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Pane({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${glass} rounded-xl flex flex-col min-h-0 ${className}`}>
      <header className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-black/[0.05] dark:border-white/[0.06]">
        <span className="font-medium text-[11.5px]">{title}</span>
        {action}
      </header>
      <div className="flex-1 min-h-0 overflow-auto p-1.5">{children}</div>
    </section>
  );
}

// ---------- Variant A: every column visible, each a floating glass card ----------
function VariantA() {
  const ed = useEditor();
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <header className={`${glass} rounded-xl h-10 shrink-0 flex items-center justify-between px-3`}>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={ed.toggleSidebar}>☰</button>
          <span className="font-medium">InterNACHI Residential</span>
          <span className="text-neutral-400">· Imported</span>
        </div>
        <HeaderActions ed={ed} />
      </header>
      <div className="flex flex-1 min-h-0 gap-2">
        {ed.sidebar && (
          <Pane title="Templates" className="w-[200px] shrink-0" action={<span className="text-[10px] text-neutral-400">New ▾</span>}>
            <TemplateList />
          </Pane>
        )}
        <Pane title="Sections" className="w-[190px] shrink-0" action={<span className="text-neutral-400">+</span>}>
          <ColList items={sections} active={ed.s} onPick={ed.pickS} render={(s) => <span className="truncate">{s.name}</span>} />
        </Pane>
        <Pane title="Items" className="w-[210px] shrink-0" action={<span className="text-neutral-400">+</span>}>
          <ColList items={ed.section.items} active={ed.i} onPick={ed.pickI} render={(it) => <><span className="flex-1 truncate">{it.name}</span><span className="text-[10px] text-neutral-400">{it.comments.length}</span></>} />
        </Pane>
        <Pane title="Comments" className="w-[250px] shrink-0">
          <CommentList ed={ed} />
        </Pane>
        <Pane title="Comment" className="flex-1 min-w-[360px]" action={<span className="text-[10px] text-neutral-400">↑ ↓ · Delete</span>}>
          <div className="p-2"><CommentDetail ed={ed} dense={ed.trust || ed.versions} /></div>
        </Pane>
        {ed.trust && <Pane title="Trust Report" className="w-[300px] shrink-0" action={<button onClick={ed.toggleTrust} className="text-neutral-400">×</button>}><div className="p-1.5"><TrustPane /></div></Pane>}
        {ed.versions && <Pane title="Versions" className="w-[240px] shrink-0" action={<button onClick={ed.toggleVersions} className="text-neutral-400">×</button>}><VersionsPane /></Pane>}
      </div>
    </div>
  );
}

// ---------- Variant B: one glass window, columns left of focus collapse to rails ----------
function Rail({ title, value, onClick }: { title: string; value: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="w-9 shrink-0 border-r border-black/[0.05] dark:border-white/[0.06] flex flex-col items-center py-3 gap-3 cursor-pointer hover:bg-black/[0.03]">
      <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] text-neutral-600 dark:text-neutral-300 truncate max-h-[70%]">{value}</span>
      <span className="mt-auto [writing-mode:vertical-rl] rotate-180 text-[10px] font-light tracking-[0.08em] text-neutral-400">{title}</span>
    </div>
  );
}

function VariantB() {
  const ed = useEditor();
  const [focus, setFocus] = useState<0 | 1 | 2>(2); // 0 sections, 1 items, 2 comments (+ detail)
  const col = "flex flex-col min-h-0 border-r border-black/[0.05] dark:border-white/[0.06]";
  const colHead = (t: string) => <div className={`${label} px-3 h-8 flex items-center shrink-0`}>{t}</div>;
  return (
    <div className="flex h-full p-3 gap-3">
      {/* icon rail sidebar, expands on hover */}
      <aside className={`${glass} group rounded-2xl w-11 hover:w-[220px] transition-[width] duration-200 overflow-hidden flex flex-col shrink-0`}>
        <div className="h-11 flex items-center px-3.5 gap-3 shrink-0"><span className="text-[13px]">◧</span><span className="opacity-0 group-hover:opacity-100 font-medium whitespace-nowrap">Templates</span></div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 flex flex-col gap-2 min-w-[208px]">
          <TemplateList />
          <NewMenu />
        </div>
      </aside>
      <div className={`${glass} rounded-2xl flex-1 flex flex-col min-w-0 overflow-hidden relative`}>
        <header className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-black/[0.05] dark:border-white/[0.06]">
          <div className="flex items-center gap-1.5 text-neutral-400 truncate">
            <span className="text-neutral-900 dark:text-white font-medium">InterNACHI Residential</span>
            <span>/</span><span className="cursor-pointer hover:text-neutral-700" onClick={() => setFocus(0)}>{ed.section.name}</span>
            <span>/</span><span className="cursor-pointer hover:text-neutral-700" onClick={() => setFocus(1)}>{ed.item.name}</span>
            <span>/</span><span className="text-neutral-700 dark:text-neutral-300">{ed.comment.name}</span>
          </div>
          <HeaderActions ed={ed} />
        </header>
        <div className="flex flex-1 min-h-0">
          {focus > 0 ? <Rail title="Sections" value={ed.section.name} onClick={() => setFocus(0)} /> : (
            <div className={`${col} w-[240px]`}>{colHead("Sections")}<div className="overflow-auto px-1.5"><ColList items={sections} active={ed.s} onPick={(n) => { ed.pickS(n); setFocus(1); }} render={(s) => <span className="truncate">{s.name}</span>} /></div></div>
          )}
          {focus > 1 ? <Rail title="Items" value={ed.item.name} onClick={() => setFocus(1)} /> : (
            <div className={`${col} w-[240px]`}>{colHead("Items")}<div className="overflow-auto px-1.5"><ColList items={ed.section.items} active={ed.i} onPick={(n) => { ed.pickI(n); setFocus(2); }} render={(it) => <><span className="flex-1 truncate">{it.name}</span><span className="text-[10px] text-neutral-400">{it.comments.length}</span></>} /></div></div>
          )}
          <div className={`${col} w-[260px]`}>{colHead("Comments")}<div className="overflow-auto px-1.5 pb-3"><CommentList ed={ed} /></div></div>
          <div className="flex-1 min-w-0 overflow-auto p-5"><div className="max-w-[760px]"><CommentDetail ed={ed} /></div></div>
        </div>
        {/* right panes: overlay sheets floating over the editor */}
        {(ed.trust || ed.versions) && (
          <div className="absolute top-14 right-3 bottom-3 flex gap-2">
            {ed.versions && <div className={`${glass} !bg-white/75 dark:!bg-neutral-900/75 rounded-xl w-[240px] flex flex-col overflow-hidden`}><div className="h-9 px-3 flex items-center justify-between font-medium text-[11.5px] border-b border-black/[0.05]">Versions<button onClick={ed.toggleVersions} className="text-neutral-400">×</button></div><div className="p-1.5 overflow-auto"><VersionsPane /></div></div>}
            {ed.trust && <div className={`${glass} !bg-white/75 dark:!bg-neutral-900/75 rounded-xl w-[320px] flex flex-col overflow-hidden`}><div className="h-9 px-3 flex items-center justify-between font-medium text-[11.5px] border-b border-black/[0.05]">Trust Report<button onClick={ed.toggleTrust} className="text-neutral-400">×</button></div><div className="p-3 overflow-auto"><TrustPane /></div></div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Variant C: drill-in navigator, whole Item as a document, tabbed inspector ----------
function VariantC() {
  const ed = useEditor();
  const [level, setLevel] = useState<0 | 1>(1); // 0 sections, 1 items of section
  const [tab, setTab] = useState<"Comment" | "Trust Report" | "Versions">("Comment");
  useEffect(() => { if (ed.trust) setTab("Trust Report"); }, [ed.trust]);
  useEffect(() => { if (ed.versions) setTab("Versions"); }, [ed.versions]);
  return (
    <div className="flex h-full">
      {/* navigator: edge-to-edge glass sidebar, Cursor-style */}
      <aside className={`${glass} !border-y-0 !border-l-0 !rounded-none w-[260px] shrink-0 flex flex-col`}>
        <div className="h-11 px-3 flex items-center justify-between shrink-0 border-b border-black/[0.05]">
          <select className="bg-transparent font-medium outline-none max-w-[170px] truncate"><option>InterNACHI Residential</option>{TEMPLATES.slice(1).map((t) => <option key={t.name}>{t.name}</option>)}</select>
          <span className="text-[10px] text-neutral-400">New ▾</span>
        </div>
        <div className="h-9 px-3 flex items-center gap-2 shrink-0">
          {level === 1 && <button className="text-neutral-400 hover:text-neutral-800" onClick={() => setLevel(0)}>‹</button>}
          <span className={label}>{level === 0 ? "Sections" : ed.section.name}</span>
        </div>
        <div className="flex-1 overflow-auto px-1.5">
          {level === 0 ? (
            <ColList items={sections} active={ed.s} onPick={(n) => { ed.pickS(n); setLevel(1); }} render={(s) => <><span className="flex-1 truncate">{s.name}</span><span className="text-neutral-400">›</span></>} />
          ) : (
            <ColList items={ed.section.items} active={ed.i} onPick={ed.pickI} render={(it) => <><span className="flex-1 truncate">{it.name}</span><span className="text-[10px] text-neutral-400">{it.comments.length}</span></>} />
          )}
        </div>
      </aside>
      {/* item document: all Comments of the Item, grouped by type, scroll to edit */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-11 shrink-0 flex items-center justify-between px-5">
          <span className="text-neutral-400">{ed.section.name} / <span className="text-neutral-800 dark:text-neutral-200">{ed.item.name}</span></span>
          <HeaderActions ed={ed} />
        </header>
        <div className="flex-1 overflow-auto px-8 pb-24">
          <div className="max-w-[720px] mx-auto">
            <h1 className="text-[20px] font-semibold tracking-tight mt-4 mb-6">{ed.item.name}</h1>
            {grouped(ed.item).map((g) => (
              <div key={g.t} className="mb-8">
                <div className="flex items-center justify-between mb-2"><span className={label}>{TYPE_LABEL[g.t]} · {g.list.length}</span><span className="text-[10px] text-neutral-400">+ New</span></div>
                <div className="flex flex-col gap-1">
                  {g.list.map(({ c, idx }) => (
                    <div key={idx} onClick={() => { ed.pickC(idx); setTab("Comment"); }} className={`rounded-lg px-3 py-2 cursor-default border transition-colors ${idx === ed.c ? "bg-white/70 dark:bg-white/[0.06] border-black/[0.1] dark:border-white/[0.12] shadow-sm" : "border-transparent hover:bg-white/40 dark:hover:bg-white/[0.03]"}`}>
                      <div className="flex items-center gap-2"><Dot type={c.type} /><span className="font-medium">{c.name}</span><span className="ml-auto flex items-center gap-2 text-[10px] text-neutral-400">{c.category && CATEGORY[c.category]}{c.rec && <span>{c.rec}</span>}<TypeGlyph answer={c.answer} /></span></div>
                      {c.text ? <div className="mt-1 pl-3.5 text-neutral-500 line-clamp-2 [&_p]:inline" dangerouslySetInnerHTML={{ __html: c.text }} /> : c.options && <div className="mt-1 pl-3.5 text-neutral-400">{c.options}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      {/* inspector: tabs switch between the selected Comment, Trust Report and Versions */}
      <aside className={`${glass} !border-y-0 !border-r-0 !rounded-none w-[380px] shrink-0 flex flex-col`}>
        <div className="h-11 px-2 flex items-center gap-1 shrink-0 border-b border-black/[0.05]">
          {(["Comment", "Trust Report", "Versions"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`${row} !py-1 ${tab === t ? rowActive : rowIdle}`}>{t}</button>
          ))}
        </div>
        <div className="flex-1 overflow-auto p-3">
          {tab === "Comment" && <CommentDetail ed={ed} dense />}
          {tab === "Trust Report" && <TrustPane />}
          {tab === "Versions" && <VersionsPane />}
        </div>
      </aside>
    </div>
  );
}

// ---------- switcher ----------
function Switcher({ current }: { current: Variant }) {
  const router = useRouter();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = (d: number) => router.replace(`?variant=${VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length].key}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full bg-fuchsia-600 text-white shadow-xl px-1.5 py-1 text-[12px] font-sans">
      <button className="px-2 hover:bg-white/20 rounded-full" onClick={() => go(-1)}>←</button>
      <span className="px-2 whitespace-nowrap">PROTOTYPE · {current} ({VARIANTS[idx].name})</span>
      <button className="px-2 hover:bg-white/20 rounded-full" onClick={() => go(1)}>→</button>
    </div>
  );
}

export default function Prototype({ variant }: { variant: Variant }) {
  return (
    <Backdrop>
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <Switcher current={variant} />
    </Backdrop>
  );
}
