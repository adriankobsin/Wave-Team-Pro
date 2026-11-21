export const EXPENSE_STATUS = { draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Returned", cancelled: "Withdrawn" } as const;
export const EXPENSE_TONE = { draft: "neutral", submitted: "warn", approved: "ok", rejected: "danger", cancelled: "neutral" } as const;
export const REIMBURSE_LABEL = { not_required: "No reimbursement", pending: "Reimbursement due", paid: "Reimbursed" } as const;
export const PAYMENT_LABEL = { personal: "My own card", company_card: "Company card", cash: "Cash (my own)", other: "Other" } as const;
export const READING_LABEL: Record<string, string> = {
  none: "",
  pending: "Waiting to read receipt…",
  processing: "Reading receipt…",
  done: "Receipt read — please check",
  failed: "Couldn't read receipt",
  skipped: "Enter details by hand",
};
