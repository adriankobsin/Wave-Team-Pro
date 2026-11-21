import { saveSignature } from "@/server/actions/outlook";
import { ActionForm } from "@/components/ui/action-form";
import { TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** The sender's saved signature, used on invites and updates. */
export function SignatureForm({ signature, example }: { signature: string | null; example: string }) {
  return (
    <ActionForm action={saveSignature} className="space-y-3 p-4 sm:p-5">
      <TextAreaField label="Signature" name="signature" optional rows={5} maxLength={2000} defaultValue={signature ?? ""} placeholder={example} hint="Shown at the bottom of every invite and update you send, exactly as typed here." />
      <SubmitButton variant="secondary" pendingLabel="Saving…">Save signature</SubmitButton>
    </ActionForm>
  );
}
