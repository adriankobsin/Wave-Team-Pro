"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/misc";
import { CREDENTIAL_CATEGORIES } from "@/lib/credentials";
import { removeCredential, revealCredential, saveCredential } from "@/server/actions/credentials";
import { cn } from "@/lib/utils";

export type CredentialRow = {
  id: string; name: string; category: string; address: string | null; username: string | null; has_password: boolean;
  project_id: string | null; project_name: string | null; device_id: string | null; device_name: string | null; notes: string | null; updated_at: string;
};
type Option = { id: string; name: string };

const HIDE_AFTER_MS = 30_000;

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function CopyButton({ get, label }: { get: () => Promise<string | null> | string | null; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={label} title={label} className="rounded p-1 text-ink-muted hover:bg-panel-sunk hover:text-ink"
      onClick={async () => { const v = await get(); if (v !== null && (await copy(v))) { setDone(true); setTimeout(() => setDone(false), 1500); } }}>
      {done ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  );
}

/** The password cell: hidden until "Show" (recorded), hides itself again after 30 seconds. */
function PasswordCell({ row }: { row: CredentialRow }) {
  const [shown, setShown] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!row.has_password) return <span className="text-ink-muted">—</span>;
  const fetchIt = async () => {
    const r = await revealCredential(row.id);
    if (!r.ok) { setErr(r.error); return null; }
    return r.password;
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("tabular rounded bg-panel-sunk px-2 py-0.5 text-sm", shown === null && "tracking-widest text-ink-muted")}>{shown ?? "••••••••"}</span>
      <button type="button" disabled={pending} aria-label={shown === null ? `Show password for ${row.name}` : "Hide password"} title={shown === null ? "Show (recorded)" : "Hide"}
        className="rounded p-1 text-ink-muted hover:bg-panel-sunk hover:text-ink"
        onClick={() => {
          if (shown !== null) { setShown(null); return; }
          start(async () => {
            const p = await fetchIt();
            if (p === null) return;
            setShown(p);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setShown(null), HIDE_AFTER_MS);
          });
        }}>
        {shown === null ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
      </button>
      <CopyButton label={`Copy password for ${row.name}`} get={() => shown ?? fetchIt()} />
      {err ? <span className="text-xs text-danger">{err}</span> : null}
    </span>
  );
}

/** A strong random password (letters, digits, symbols; no look-alikes). */
function generate(len = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%+=?@";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

function PasswordInput({ editing }: { editing: boolean }) {
  const [visible, setVisible] = useState(false);
  const [set, setSet] = useState(!editing);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5 sm:col-span-2">
      {editing ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="setPassword" checked={set} onChange={(e) => setSet(e.target.checked)} className="size-4" /> Change the password
        </label>
      ) : null}
      {set ? (
        <div>
          <label className="text-sm font-medium" htmlFor="cred-password">Password <span className="font-normal text-ink-muted">{editing ? "(empty removes it)" : "(optional)"}</span></label>
          <div className="mt-1 flex gap-2">
            <input id="cred-password" ref={ref} name="password" type={visible ? "text" : "password"} autoComplete="new-password" maxLength={1000} spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm focus:border-brass focus:outline-none" />
            <button type="button" className="rounded-md border border-line px-3 text-sm hover:bg-panel-sunk" onClick={() => setVisible((v) => !v)}>{visible ? "Hide" : "Show"}</button>
            <button type="button" className="rounded-md border border-line px-3 text-sm hover:bg-panel-sunk" onClick={() => { if (ref.current) { ref.current.value = generate(); setVisible(true); } }}>Generate</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Add / edit form. `projects` lets a company-wide page file a login under a project. */
export function CredentialForm({ orgId, row, projects, devices, fixedProject, onDone }: {
  orgId: string; row?: CredentialRow; projects?: Option[]; devices?: Option[]; fixedProject?: string | null; onDone?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(row);
  return (
    <ActionForm action={async (prev: Parameters<typeof saveCredential>[0], fd: FormData) => { const r = await saveCredential(prev, fd); if (r.ok) { router.refresh(); onDone?.(); } return r; }}
      resetOnSuccess={!editing} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="orgId" value={orgId} />
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      {fixedProject !== undefined ? <input type="hidden" name="projectId" value={fixedProject ?? ""} /> : null}
      <TextField label="Name" name="name" required maxLength={120} defaultValue={row?.name} placeholder="Fortigate 200F" />
      <SelectField label="Kind" name="category" defaultValue={row?.category ?? "device"}>
        {Object.entries(CREDENTIAL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </SelectField>
      <div className="sm:col-span-2"><TextField label="Address" name="address" optional maxLength={300} defaultValue={row?.address ?? ""} placeholder="https://192.168.10.99 or portal.starlink.com" /></div>
      <TextField label="Username" name="username" optional maxLength={200} defaultValue={row?.username ?? ""} autoComplete="off" spellCheck={false} />
      <PasswordInput key={row?.id ?? "new"} editing={editing} />
      {fixedProject === undefined && projects ? (
        <SelectField label="Project" name="projectId" defaultValue={row?.project_id ?? ""}>
          <option value="">Company-wide (no project)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      ) : null}
      {!devices?.length && row?.device_id ? <input type="hidden" name="deviceId" value={row.device_id} /> : null}
      {devices?.length ? (
        <SelectField label="Device in this project" name="deviceId" defaultValue={row?.device_id ?? ""}>
          <option value="">—</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectField>
      ) : null}
      <div className="sm:col-span-2 lg:col-span-4"><TextAreaField label="Notes" name="notes" optional rows={2} maxLength={2000} defaultValue={row?.notes ?? ""} placeholder="Second admin account, licence key location, 2FA phone…" /></div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <SubmitButton pendingLabel="Saving…">{editing ? "Save changes" : "Add login"}</SubmitButton>
        {onDone ? <button type="button" className="text-sm text-ink-muted underline" onClick={onDone}>Cancel</button> : null}
      </div>
    </ActionForm>
  );
}

/** The list of stored logins with show / copy, and edit / remove for people who manage them. */
export function CredentialList({ rows, orgId, canManage, projects, devices, fixedProject, showProject }: {
  rows: CredentialRow[]; orgId: string; canManage: boolean; projects?: Option[]; devices?: Option[]; fixedProject?: string | null; showProject: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((r) => [r.name, r.address, r.username, r.project_name, r.device_name, r.notes, CREDENTIAL_CATEGORIES[r.category as keyof typeof CREDENTIAL_CATEGORIES]].some((x) => x?.toLowerCase().includes(needle))) : rows;
  const link = (a: string) => (/^https?:\/\//i.test(a) ? a : null);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, address, username, project…" aria-label="Search logins"
          className="h-9 w-full max-w-sm rounded-md border border-line bg-panel px-3 text-sm" />
        <span className="text-sm text-ink-muted">{list.length} of {rows.length}</span>
        {msg ? <span className="ml-auto text-sm text-danger" role="status">{msg}</span> : null}
      </div>
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((r) => (
            <li key={r.id}>
              <div className="grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium"><KeyRound className="size-4 shrink-0 text-brass" aria-hidden /> <span className="truncate">{r.name}</span></p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                    <Badge tone="neutral">{CREDENTIAL_CATEGORIES[r.category as keyof typeof CREDENTIAL_CATEGORIES] ?? r.category}</Badge>
                    {showProject ? <span>{r.project_name ?? "Company-wide"}</span> : null}
                    {r.device_name ? <span>· {r.device_name}</span> : null}
                  </p>
                </div>
                <div className="min-w-0 text-sm">
                  {r.address ? (link(r.address)
                    ? <a href={link(r.address)!} target="_blank" rel="noopener noreferrer" className="block truncate underline-offset-4 hover:underline">{r.address}</a>
                    : <span className="tabular block truncate">{r.address}</span>) : <span className="text-ink-muted">—</span>}
                  {r.notes ? <p className="truncate text-xs text-ink-muted" title={r.notes}>{r.notes}</p> : null}
                </div>
                <div className="min-w-0 space-y-1 text-sm">
                  <span className="inline-flex max-w-full items-center gap-1"><span className="truncate">{r.username ?? <span className="text-ink-muted">no username</span>}</span>{r.username ? <CopyButton label={`Copy username for ${r.name}`} get={() => r.username} /> : null}</span>
                  <div><PasswordCell row={r} /></div>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-3 text-sm">
                    <button type="button" className="inline-flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => setEditing(editing === r.id ? null : r.id)}><Pencil className="size-4" aria-hidden /> Edit</button>
                    <button type="button" disabled={pending} className="text-danger underline"
                      onClick={() => { if (window.confirm(`Remove ${r.name}? Its password is wiped and can't be recovered.`)) start(async () => { const x = await removeCredential(r.id); setMsg(x.ok ? null : x.error); if (x.ok) router.refresh(); }); }}>Remove</button>
                  </div>
                ) : <span />}
              </div>
              {editing === r.id ? (
                <div className="border-t border-line bg-panel-sunk/50">
                  <CredentialForm orgId={orgId} row={r} projects={projects} devices={devices} fixedProject={fixedProject} onDone={() => setEditing(null)} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-8 text-center text-sm text-ink-muted">{rows.length ? "Nothing matches that search." : "No logins saved yet."}</p>}
    </div>
  );
}
