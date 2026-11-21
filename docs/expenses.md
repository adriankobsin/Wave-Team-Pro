# Expenses & receipts (Phase D)

## Flow
1. **Capture**: an employee photographs or uploads 1–5 receipts (JPEG/PNG/WebP/PDF). Phone photos are downscaled in the browser so they fit the hosting request limit. The server checks the real file type from its bytes and re-encodes images, which strips EXIF/GPS.
2. **Reading (optional)**: when `AI_PROVIDER`, `AI_API_KEY` and `AI_MODEL` are set, each receipt gets an `expense_ai_extractions` row and is read in the background (`after()`):
   - Claimed atomically. A run that is stuck in `processing` for more than 5 minutes can be reclaimed.
   - Retried up to 3 times with backoff. After that it is parked as `failed` (the dead-letter state) and the employee can press *Try again*.
   - The model may only answer through one tool whose output is validated with Zod. Unreadable fields stay empty and no numbers are inferred.
   - The raw reading is stored separately. Only empty draft fields are filled.
   - Telemetry logs provider, model, latency and token counts, never receipt contents.
3. **Review by employee**:
   - Fields the model was unsure of are marked "Please check".
   - The draft is flagged if subtotal + tax + tip ≠ total, or if the date is in the future.
4. **Submit** (`submit_expense`):
   - Required fields must be filled.
   - Receipt-required categories need a receipt or a written reason.
   - Duplicates are detected by the same file hash anywhere in the org, or by the same person + merchant + date + total. The employee must explicitly confirm "separate purchase" to submit a duplicate.
5. **Approve / return / correct**:
   - The deciding user needs `expenses.approve` (org-wide or project-scoped), or must be the submitter's manager holding that permission. Nobody can approve their own claim.
   - Corrections store old and new values in `expense_events`, which is append-only.
6. **Reimburse**: `reimbursements.manage` users mark approved, employee-paid claims as paid, with a payment reference. Reimbursement is separate from approval.
7. **Export**: `expenses.export` users download:
   - XLSX with an Expenses sheet (one row per expense), a Summary sheet (per currency, never mixed) and a Line items sheet.
   - Or a ZIP with the XLSX, the original receipts and `manifest.csv`.
   - Text cells are protected against formula injection. Every export is logged in `expense_exports` and the audit log.

## Currencies
The original amount and currency are always kept. Reporting amounts are in the organization's base currency and use the latest bookkeeper-entered rate on or before the receipt date. The rate, its date and its source are stored on the expense, and amounts are rounded to 2 decimals. Without a rate, the converted amount stays empty and is excluded from converted totals, rather than guessed.

## Not in scope
General ledger, payroll, bank integrations, tax filing and supplier records. Merchant names are plain text.

## Bookkeeping (Expenses → Bookkeeping)
- **VAT rates**: per organization. The name in Xero must match the tax rate name in Xero exactly. Non-reclaimable rates (exempt, outside scope, foreign VAT) are excluded from reclaimable VAT. The receipt reader suggests a rate: foreign country or currency gives a non-reclaimable rate, and a single printed domestic rate is matched to the equivalent rate. Otherwise the field is left for a person.
- **Coding**: finance or approvers can set category, VAT rate, VAT amount and card on submitted or approved claims (`code_expense`). Each change is logged with old and new values.
- **Company cards**: only the last 4 digits are stored. Finance imports statement CSVs. The importer detects columns, skips refunds and payments, and won't import the same line twice. Lines auto-match to card claims with the same amount and currency within ±3 days, one-to-one. Unmatched lines can be matched by hand, ignored, or sent to the holder ("Ask for the receipt"), which creates a draft claim for them and notifies them. A receipt that shows a card ending matching the holder's card is automatically marked as a card payment.
- **Xero**:
  - Employee-paid claims go out as a *Bills* CSV: one bill per person and currency, tax-inclusive, with project tracking.
  - Card spend goes out as a pre-coded bank-statement CSV for each card.
  - "Download & mark exported" stamps the claims so they can't be exported twice. Exported claims are locked, and an export can be undone.
- **Month close**: closing a month blocks creating, submitting or changing claims dated in it. Approval and export remain possible, and the month can be reopened.
- **Duplicates**: the same file counts as a duplicate only when the amount also matches, because one PDF can hold several receipts. The same person, date and amount (receipt plus card slip) is flagged as a possible duplicate.
- **Multiple receipts in one file**: the reader lists them, and "Create separate expense" makes a new draft with its own copy of the file.
