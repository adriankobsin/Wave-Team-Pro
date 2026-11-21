import "server-only";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { safeText } from "@/lib/export/cells";
import { PdfReport } from "@/lib/export/pdf";
import { addLogo } from "@/lib/export/excel-logo";
import { BRAND } from "@/lib/brand";
import { countryName } from "@/lib/regions";
import { dateOf, timeOf } from "@/lib/time";

type Logo = { png: Buffer; width: number; height: number } | null;

export const NOTE_KIND: Record<string, string> = {
  note: "Note", delivery: "Delivery received", order: "Order placed", issue: "Issue", meeting: "Meeting", other: "Other",
};
const STATUS: Record<string, string> = { todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };
const PROJECT_STATUS: Record<string, string> = { planning: "Planning", active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };
const OUTCOME: Record<string, string> = { completed: "Completed", not_completed: "Not completed" };

export type ProjectReport = Awaited<ReturnType<typeof loadProjectReport>>;

/** Everything the project report shows, read with the viewer's own session (RLS applies). */
export async function loadProjectReport(projectId: string, tz: string) {
  const supabase = await createClient();
  const { data: p } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (!p) return null;
  const [{ data: org }, { data: tasks }, { data: notes }, { data: entries }, { data: expenses }, { data: hours }] = await Promise.all([
    supabase.from("organizations").select("name, base_currency").eq("id", p.organization_id).single(),
    supabase.from("tasks").select("id, title, status, priority, due_date, created_by, created_at, completed_at, outcome, outcome_note, outcome_by, outcome_at, estimate_hours, task_assignees(user_id), task_checklist_items(done)")
      .eq("project_id", projectId).is("archived_at", null).order("created_at"),
    supabase.from("project_notes").select("id, kind, title, body, supplier, reference, amount, currency, occurred_at, created_by, project_note_files(id)")
      .eq("project_id", projectId).is("archived_at", null).order("occurred_at", { ascending: false }),
    supabase.from("timesheet_entries").select("hours, work_date, timesheets!inner(status, membership_id)").eq("project_id", projectId),
    supabase.from("expenses").select("expense_date, merchant, description, total, currency, status, membership_id, expense_categories(name)")
      .eq("project_id", projectId).neq("status", "cancelled").order("expense_date", { ascending: false }),
    supabase.rpc("project_hours", { p_project: projectId }),
  ]);
  const taskIds = (tasks ?? []).map((t) => t.id as string);
  const [{ data: comments }, { data: photos }] = await Promise.all([
    taskIds.length ? supabase.from("task_comments").select("task_id").in("task_id", taskIds) : Promise.resolve({ data: [] as { task_id: string }[] }),
    taskIds.length ? supabase.from("files").select("context_id").eq("context_type", "task").in("context_id", taskIds) : Promise.resolve({ data: [] as { context_id: string }[] }),
  ]);
  type Entry = { hours: number; work_date: string; timesheets: { status: string; membership_id: string } };
  type Exp = { expense_date: string | null; merchant: string | null; description: string | null; total: number | null; currency: string | null; status: string; membership_id: string; expense_categories: { name: string } | null };
  const membershipIds = [...new Set([
    ...((entries ?? []) as unknown as Entry[]).map((e) => e.timesheets.membership_id),
    ...((expenses ?? []) as unknown as Exp[]).map((e) => e.membership_id),
    ...(p.manager_membership_id ? [p.manager_membership_id as string] : []),
  ])];
  const { data: ms } = membershipIds.length ? await supabase.from("organization_memberships").select("id, user_id").in("id", membershipIds) : { data: [] };
  const userOfMembership = new Map(((ms ?? []) as { id: string; user_id: string }[]).map((m) => [m.id, m.user_id]));
  const userIds = [...new Set([
    ...userOfMembership.values(),
    ...(tasks ?? []).flatMap((t) => [t.created_by as string, ...(t.outcome_by ? [t.outcome_by as string] : []), ...((t.task_assignees as { user_id: string }[]) ?? []).map((a) => a.user_id)]),
    ...(notes ?? []).map((n) => n.created_by as string),
  ])];
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : { data: [] };
  const nameOf = new Map(((profiles ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const name = (u: string | null | undefined) => (u && nameOf.get(u)) || "—";
  const count = (list: string[]) => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const commentCount = count((comments ?? []).map((c) => c.task_id as string));
  const photoCount = count((photos ?? []).map((f) => f.context_id as string));
  const today = dateOf(new Date().toISOString(), tz);

  const taskRows = (tasks ?? []).map((t) => {
    const checklist = (t.task_checklist_items as { done: boolean }[]) ?? [];
    const overdue = t.status !== "done" && t.due_date && (t.due_date as string) < today;
    return {
      title: t.title as string,
      assignees: ((t.task_assignees as { user_id: string }[]) ?? []).map((a) => name(a.user_id)).join(", ") || "Unassigned",
      status: STATUS[t.status as string] ?? (t.status as string),
      priority: (t.priority as string).replace(/^./, (c) => c.toUpperCase()),
      due: (t.due_date as string) ?? "",
      overdue: Boolean(overdue),
      outcome: t.outcome ? OUTCOME[t.outcome as string] : "",
      reportedBy: t.outcome_by ? name(t.outcome_by as string) : "",
      reportedAt: t.outcome_at ? dateOf(t.outcome_at as string, tz) : "",
      outcomeNote: (t.outcome_note as string) ?? "",
      checklist: checklist.length ? `${checklist.filter((c) => c.done).length}/${checklist.length}` : "",
      notes: commentCount.get(t.id as string) ?? 0,
      photos: photoCount.get(t.id as string) ?? 0,
      setBy: name(t.created_by as string),
      created: dateOf(t.created_at as string, tz),
      completed: t.completed_at ? dateOf(t.completed_at as string, tz) : "",
    };
  });

  const hoursByPerson = new Map<string, { approved: number; waiting: number; draft: number }>();
  for (const e of (entries ?? []) as unknown as Entry[]) {
    const who = name(userOfMembership.get(e.timesheets.membership_id));
    const h = hoursByPerson.get(who) ?? { approved: 0, waiting: 0, draft: 0 };
    const k = e.timesheets.status === "approved" ? "approved" : e.timesheets.status === "submitted" ? "waiting" : "draft";
    h[k] += Number(e.hours);
    hoursByPerson.set(who, h);
  }
  const h0 = ((hours ?? []) as { approved: number; submitted: number }[])[0];

  return {
    project: {
      name: p.name as string, code: (p.code as string) ?? "", company: org?.name ?? "", site: (p.site_label as string) ?? "",
      country: p.country ? countryName(p.country as string) : "", status: PROJECT_STATUS[p.status as string] ?? (p.status as string),
      manager: p.manager_membership_id ? name(userOfMembership.get(p.manager_membership_id as string)) : "—",
      start: (p.start_date as string) ?? "", end: (p.end_date as string) ?? "",
      budgetHours: p.budget_hours !== null ? Number(p.budget_hours) : null,
      budgetAmount: p.budget_amount !== null ? Number(p.budget_amount) : null, budgetCurrency: (p.budget_currency as string) ?? "",
      description: (p.description as string) ?? "",
    },
    approvedHours: Number(h0?.approved ?? 0), waitingHours: Number(h0?.submitted ?? 0),
    tasks: taskRows,
    counts: {
      total: taskRows.length,
      todo: taskRows.filter((t) => t.status === "To do").length,
      inProgress: taskRows.filter((t) => t.status === "In progress" || t.status === "Review").length,
      done: taskRows.filter((t) => t.status === "Done").length,
      overdue: taskRows.filter((t) => t.overdue).length,
      notCompleted: taskRows.filter((t) => t.outcome === "Not completed").length,
    },
    people: [...hoursByPerson.entries()].map(([person, h]) => ({ person, ...h })).sort((a, b) => b.approved + b.waiting - (a.approved + a.waiting)),
    expenses: ((expenses ?? []) as unknown as Exp[]).map((e) => ({
      date: e.expense_date ?? "", person: name(userOfMembership.get(e.membership_id)), merchant: e.merchant || e.description || "Expense",
      category: e.expense_categories?.name ?? "", total: e.total === null ? null : Number(e.total), currency: e.currency ?? "", status: e.status,
    })),
    log: (notes ?? []).map((n) => ({
      date: dateOf(n.occurred_at as string, tz), time: timeOf(n.occurred_at as string, tz), kind: NOTE_KIND[n.kind as string] ?? (n.kind as string),
      title: n.title as string, supplier: (n.supplier as string) ?? "", reference: (n.reference as string) ?? "",
      amount: n.amount !== null ? Number(n.amount) : null, currency: (n.currency as string) ?? "", by: name(n.created_by as string),
      details: (n.body as string) ?? "", files: ((n.project_note_files as { id: string }[]) ?? []).length,
    })),
    generated: `${today} ${timeOf(new Date().toISOString(), tz)} (${tz})`,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number | null, cur: string) => (n === null ? "" : `${n.toFixed(2)} ${cur}`.trim());

export async function projectReportWorkbook(r: NonNullable<ProjectReport>, logo?: Logo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.product;
  const p = r.project;

  const s = wb.addWorksheet("Summary");
  s.addRow([`Project report — ${p.name}`]).font = { bold: true, size: 14 };
  s.addRow([`Generated ${r.generated}`]).font = { italic: true, color: { argb: "FF6B7280" } };
  s.addRow([]);
  const kv: [string, string | number][] = [
    ["Company", p.company], ["Code", p.code], ["Site", p.site], ["Country", p.country], ["Status", p.status], ["Project manager", p.manager],
    ["Start", p.start], ["End", p.end],
    ["Approved hours", r2(r.approvedHours)], ["Hours waiting for approval", r2(r.waitingHours)],
    ["Budget hours", p.budgetHours ?? ""], ["Hours used of budget", p.budgetHours ? `${Math.round((r.approvedHours / p.budgetHours) * 100)}%` : ""],
    ["Budget", money(p.budgetAmount, p.budgetCurrency)],
    ["Tasks", r.counts.total], ["To do", r.counts.todo], ["In progress", r.counts.inProgress], ["Done", r.counts.done],
    ["Complete", r.counts.total ? `${Math.round((r.counts.done / r.counts.total) * 100)}%` : ""],
    ["Overdue", r.counts.overdue], ["Reported not completed", r.counts.notCompleted],
    ["Project log entries", r.log.length], ["Expense claims", r.expenses.length],
  ];
  for (const [k, v] of kv) {
    const row = s.addRow([k, typeof v === "string" ? safeText(v) : v]);
    row.getCell(1).font = { bold: true };
  }
  if (p.description) { s.addRow([]); s.addRow(["Description", safeText(p.description)]).getCell(1).font = { bold: true }; }
  s.getColumn(1).width = 30; s.getColumn(2).width = 60;
  addLogo(wb, s, logo ?? null, 4);

  const t = wb.addWorksheet("Tasks");
  t.addRow(["Task", "Assigned to", "Status", "Priority", "Due", "Overdue", "Report", "Reported by", "Reported on", "Report note", "Checklist", "Notes", "Photos", "Set by", "Created", "Completed"]).font = { bold: true };
  for (const x of r.tasks) {
    const row = t.addRow([safeText(x.title), safeText(x.assignees), x.status, x.priority, x.due, x.overdue ? "Yes" : "", x.outcome, safeText(x.reportedBy), x.reportedAt, safeText(x.outcomeNote), x.checklist, x.notes, x.photos, safeText(x.setBy), x.created, x.completed]);
    if (x.overdue) row.getCell(6).font = { color: { argb: "FFB91C1C" }, bold: true };
    if (x.outcome === "Not completed") row.getCell(7).font = { color: { argb: "FFB91C1C" }, bold: true };
    row.getCell(10).alignment = { wrapText: true, vertical: "top" };
  }
  [40, 28, 12, 10, 12, 9, 14, 20, 12, 50, 10, 8, 8, 20, 12, 12].forEach((w, i) => (t.getColumn(i + 1).width = w));
  t.views = [{ state: "frozen", ySplit: 1 }];
  t.autoFilter = { from: "A1", to: "P1" };

  const l = wb.addWorksheet("Project log");
  l.addRow(["Date", "Time", "Type", "Title", "Supplier / from", "Reference", "Amount", "Currency", "By", "Details", "Files"]).font = { bold: true };
  for (const x of r.log) {
    const row = l.addRow([x.date, x.time, x.kind, safeText(x.title), safeText(x.supplier), safeText(x.reference), x.amount ?? "", x.currency, safeText(x.by), safeText(x.details), x.files]);
    row.getCell(10).alignment = { wrapText: true, vertical: "top" };
  }
  [12, 8, 18, 36, 26, 18, 12, 9, 20, 60, 7].forEach((w, i) => (l.getColumn(i + 1).width = w));
  l.views = [{ state: "frozen", ySplit: 1 }];

  const h = wb.addWorksheet("Hours by person");
  h.addRow(["Person", "Approved", "Waiting for approval", "Not submitted", "Total"]).font = { bold: true };
  for (const x of r.people) h.addRow([safeText(x.person), r2(x.approved), r2(x.waiting), r2(x.draft), r2(x.approved + x.waiting + x.draft)]);
  h.addRow(["Total", r2(r.people.reduce((n, x) => n + x.approved, 0)), r2(r.people.reduce((n, x) => n + x.waiting, 0)), r2(r.people.reduce((n, x) => n + x.draft, 0)), r2(r.people.reduce((n, x) => n + x.approved + x.waiting + x.draft, 0))]).font = { bold: true };
  [30, 12, 20, 14, 12].forEach((w, i) => (h.getColumn(i + 1).width = w));

  const e = wb.addWorksheet("Expenses");
  e.addRow(["Date", "Person", "Merchant / description", "Category", "Amount", "Currency", "Status"]).font = { bold: true };
  for (const x of r.expenses) e.addRow([x.date, safeText(x.person), safeText(x.merchant), safeText(x.category), x.total ?? "", x.currency, x.status]);
  [12, 24, 36, 22, 12, 9, 12].forEach((w, i) => (e.getColumn(i + 1).width = w));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function projectReportPdf(r: NonNullable<ProjectReport>, logo?: Logo): Promise<Buffer> {
  const p = r.project;
  const pdf = await PdfReport.create(`${BRAND.product} · ${p.company} · ${p.name} · ${r.generated}`, logo);
  pdf.title(`Project report — ${p.name}`, [p.company, p.code, p.site, p.country, p.status].filter(Boolean).join(" · "));
  writeProjectReport(pdf, r);
  return pdf.bytes();
}

/** The report's sections (summary, tasks, log, hours, expenses), written into an existing PDF. */
export function writeProjectReport(pdf: PdfReport, r: NonNullable<ProjectReport>, only?: { tasks?: boolean; log?: boolean; money?: boolean }) {
  const p = r.project;
  const want = { tasks: true, log: true, money: true, ...only };
  pdf.heading("Summary");
  pdf.table([{ label: "", width: 40 }, { label: "", width: 60 }, { label: "", width: 40 }, { label: "", width: 60 }], [
    ["Project manager", p.manager, "Dates", [p.start, p.end].filter(Boolean).join(" to ") || "—"],
    ["Approved hours", `${r2(r.approvedHours)}${p.budgetHours ? ` of ${p.budgetHours} (${Math.round((r.approvedHours / p.budgetHours) * 100)}%)` : ""}`, "Waiting for approval", `${r2(r.waitingHours)} h`],
    ["Budget", money(p.budgetAmount, p.budgetCurrency) || "—", "Expense claims", String(r.expenses.length)],
    ["Tasks", `${r.counts.total} (${r.counts.done} done, ${r.counts.total ? Math.round((r.counts.done / r.counts.total) * 100) : 0}%)`, "Overdue / not completed", `${r.counts.overdue} / ${r.counts.notCompleted}`],
  ]);
  if (want.tasks) {
  pdf.heading("Tasks", `${r.counts.todo} to do · ${r.counts.inProgress} in progress · ${r.counts.done} done`);
  if (r.tasks.length) {
    pdf.table(
      [{ label: "Task", width: 52 }, { label: "Assigned to", width: 34 }, { label: "Status", width: 18 }, { label: "Due", width: 18 }, { label: "Report", width: 22 }, { label: "Reported by", width: 26 }],
      r.tasks.map((x) => [x.title, x.assignees, x.status, x.due ? `${x.due}${x.overdue ? " (late)" : ""}` : "", x.outcome, x.reportedBy]),
    );
    const notes = r.tasks.filter((x) => x.outcomeNote);
    if (notes.length) {
      pdf.heading("What people reported");
      for (const x of notes) pdf.text(`${x.title} — ${x.outcome}, ${x.reportedBy}, ${x.reportedAt}: ${x.outcomeNote.replace(/\s+/g, " ")}`);
    }
  } else pdf.text("No tasks yet.");
  }
  if (want.log) {
  pdf.heading("Project log", `${r.log.length} entries`);
  if (r.log.length) {
    pdf.table(
      [{ label: "Date", width: 24 }, { label: "Type", width: 24 }, { label: "Title", width: 50 }, { label: "Supplier / from", width: 34 }, { label: "Reference", width: 24 }, { label: "Amount", width: 22, align: "right" }],
      r.log.map((x) => [`${x.date} ${x.time}`, x.kind, x.title, x.supplier, x.reference, money(x.amount, x.currency)]),
    );
  } else pdf.text("No entries yet.");
  }
  if (!want.money) return;
  if (r.people.length) {
    pdf.heading("Hours by person");
    pdf.table(
      [{ label: "Person", width: 50 }, { label: "Approved", width: 20, align: "right" }, { label: "Waiting", width: 20, align: "right" }, { label: "Not submitted", width: 22, align: "right" }],
      r.people.map((x) => [x.person, r2(x.approved), r2(x.waiting), r2(x.draft)]),
    );
  }
  if (r.expenses.length) {
    pdf.heading("Expenses");
    pdf.table(
      [{ label: "Date", width: 20 }, { label: "Person", width: 30 }, { label: "Merchant", width: 44 }, { label: "Category", width: 28 }, { label: "Amount", width: 24, align: "right" }, { label: "Status", width: 18 }],
      r.expenses.map((x) => [x.date, x.person, x.merchant, x.category, money(x.total, x.currency), x.status]),
    );
  }
}
