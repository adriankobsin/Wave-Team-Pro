"use client";

import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ITEM_STATUS } from "@/lib/site-constants";
import { addDevice } from "@/server/actions/site";

/** "Add a device" panel: anything not in the spreadsheet (a keypad, a TV, a shelf-mounted box…). */
export function AddDevice({ projectId }: { projectId: string }) {
  return (
    <details className="rounded-lg border border-line bg-panel">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">+ Add a device</summary>
      <ActionForm action={addDevice} resetOnSuccess className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="projectId" value={projectId} />
        <div className="sm:col-span-2"><TextField label="Name" name="name" required maxLength={200} placeholder="Owner's cabin TV" /></div>
        <TextField label="Manufacturer" name="manufacturer" optional maxLength={80} list="dl-manufacturers" placeholder="Pick or type" />
        <TextField label="Model" name="model" optional maxLength={120} placeholder="QE65QN95D" />
        <TextField label="Type" name="type" optional maxLength={80} list="dl-types" placeholder="TV" />
        <TextField label="System" name="system" optional maxLength={80} list="dl-systems" placeholder="AV" />
        <TextField label="Deck" name="deck" optional maxLength={80} list="dl-decks" placeholder="OD" />
        <TextField label="Room / area" name="room" optional maxLength={80} list="dl-rooms" />
        <TextField label="Location" name="location" optional maxLength={120} placeholder="Wall above sideboard" />
        <TextField label="IP address" name="ip" optional maxLength={60} />
        <TextField label="MAC" name="mac" optional maxLength={40} />
        <TextField label="Serial" name="serial" optional maxLength={80} />
        <SelectField label="Status" name="status" defaultValue="planned">
          {Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </SelectField>
        <div className="flex items-end sm:col-span-2 lg:col-span-3"><SubmitButton pendingLabel="Adding…">Add device</SubmitButton></div>
      </ActionForm>
    </details>
  );
}
