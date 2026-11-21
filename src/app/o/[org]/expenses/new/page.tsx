import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createExpense } from "@/server/actions/expenses";
import { aiProviderLabel } from "@/lib/ai/provider";
import { ActionForm } from "@/components/ui/action-form";
import { CheckboxField, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccessDenied, PageHeader, Panel } from "@/components/ui/misc";
import { ReceiptPicker } from "@/components/expenses/receipt-picker";

export const metadata: Metadata = { title: "New expense" };

export default async function NewExpensePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.perms.has("expenses.create")) return <AccessDenied message="Your role can't submit expenses." hint="Ask an administrator." />;
  const supabase = await createClient();
  const [{ data: categories }, { data: projects }] = await Promise.all([
    supabase.from("expense_categories").select("id, name").eq("organization_id", ctx.org.id).eq("active", true).order("name"),
    supabase.from("projects").select("id, name, code").eq("organization_id", ctx.org.id).in("status", ["planning", "active", "on_hold"]).order("name"),
  ]);
  const ai = aiProviderLabel();

  return (
    <div className="max-w-2xl space-y-6">
      <Link href={`/o/${ctx.org.slug}/expenses`} className="text-sm text-ink-muted underline-offset-4 hover:underline">Expenses</Link>
      <PageHeader title="New expense" description="Photograph or upload the receipt. You'll check the details before submitting." />
      <Panel>
        <ActionForm action={createExpense} className="space-y-5 p-4 sm:p-5">
          <input type="hidden" name="organization_id" value={ctx.org.id} />
          <input type="hidden" name="org_slug" value={ctx.org.slug} />
          <div className="space-y-2">
            <p className="text-sm font-medium">Receipt</p>
            <ReceiptPicker />
            <p className="text-xs text-ink-muted">JPEG, PNG, WebP or PDF, up to 5 files. No receipt? Continue without one and give a reason on the next screen.</p>
          </div>
          {ai ? (
            <CheckboxField
              name="auto_read"
              defaultChecked
              label="Read the receipt automatically"
              hint={`The receipt image is sent to ${ai}, a third-party AI service, to fill in merchant, date and amounts. Untick to type them yourself.`}
            />
          ) : (
            <p className="rounded-md bg-panel-sunk px-3 py-2 text-sm text-ink-muted">Automatic receipt reading isn’t switched on, so you’ll type the details on the next screen.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Category" name="category_id" optional defaultValue="">
              <option value="">Choose later</option>
              {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
            {ctx.perms.has("work.self_manage") ? (
              <SelectField label="Project" name="project_id" optional defaultValue="">
                <option value="">No project</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>)}
              </SelectField>
            ) : null}
          </div>
          <TextAreaField label="Business purpose" name="description" optional rows={2} maxLength={1000} placeholder="e.g. Fuel for site visit to Harbour Road" />
          <SubmitButton pendingLabel="Uploading…">Continue</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
