"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/rate-limit";
import { UploadError, validateUpload } from "@/lib/files/validate";
import { storeFile } from "@/server/services/files";
import { resolveMentions } from "@/server/services/chat";
import { listPeople } from "@/server/services/people";
import { formObject, uuid } from "@/lib/validation/common";
import { friendlyDbError, logServerError, type ActionResult } from "@/lib/errors";

const slugRe = /^[a-z0-9-]+$/;

async function me() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}

const sendSchema = z.object({
  organization_id: uuid,
  conversation_id: uuid,
  body: z.string().max(8000).transform((s) => s.trim()),
  parent_id: z.union([z.literal(""), uuid]).optional().transform((v) => v || null),
});

export async function sendMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = sendSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Message is too long." };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5);
  if (!parsed.data.body && files.length === 0) return { ok: false, error: "Write a message or attach a file." };

  const { supabase, userId } = await me();
  if (!userId) return { ok: false, error: "Sign in again to continue." };
  if (!(await consumeRateLimit(["chat", userId], 120, 60))) return { ok: false, error: "You're sending messages too quickly." };

  // Validate attachments before posting so a bad file doesn't leave an empty message.
  let uploads;
  try {
    uploads = await Promise.all(files.map((f) => validateUpload(f)));
  } catch (e) {
    return { ok: false, error: e instanceof UploadError ? e.message : "One of the files couldn't be processed." };
  }

  const { data: conv } = await supabase.from("conversations").select("type").eq("id", parsed.data.conversation_id).maybeSingle();
  let mentions: string[] = [];
  if (conv && parsed.data.body.includes("@")) {
    const people = await listPeople(parsed.data.organization_id);
    mentions = resolveMentions(parsed.data.body, people.map((p) => ({ userId: p.userId, name: p.name }))).filter((id) => id !== userId);
  }

  const { data: msg, error } = await supabase
    .from("messages")
    .insert({
      organization_id: parsed.data.organization_id,
      conversation_id: parsed.data.conversation_id,
      body: parsed.data.body,
      parent_id: parsed.data.parent_id,
      mentions,
    })
    .select("id")
    .single();
  if (error || !msg) return { ok: false, error: friendlyDbError(error, "Couldn't send the message.") };

  if (uploads.length) {
    const admin = createAdminClient();
    try {
      for (const up of uploads) {
        const stored = await storeFile({ orgId: parsed.data.organization_id, userId, context: "message", contextId: msg.id, upload: up });
        await admin.from("message_attachments").insert({ message_id: msg.id, file_id: stored.id });
      }
    } catch (e) {
      logServerError("chat.attach", e);
      return { ok: false, error: "The message was sent, but an attachment failed to upload. Try attaching it again." };
    }
  }
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true };
}

const messageRef = z.object({ message_id: uuid, conversation_id: uuid });

export async function editMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = messageRef.extend({ body: z.string().trim().min(1).max(8000) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Message can't be empty." };
  const { supabase } = await me();
  const { error } = await supabase.from("messages").update({ body: parsed.data.body }).eq("id", parsed.data.message_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true };
}

export async function deleteMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = messageRef.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown message." };
  const { supabase } = await me();
  const { error } = await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", parsed.data.message_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true };
}

export async function togglePin(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = messageRef.extend({ pin: z.enum(["1", "0"]) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown message." };
  const { supabase } = await me();
  const { error } = await supabase
    .from("messages")
    .update({ pinned_at: parsed.data.pin === "1" ? new Date().toISOString() : null })
    .eq("id", parsed.data.message_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true };
}

export async function toggleReaction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = messageRef.extend({ emoji: z.enum(["👍", "❤️", "😂", "🎉", "👀", "✅"]) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown reaction." };
  const { supabase, userId } = await me();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { data: existing } = await supabase
    .from("message_reactions")
    .select("emoji")
    .eq("message_id", parsed.data.message_id)
    .eq("user_id", userId)
    .eq("emoji", parsed.data.emoji)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("message_reactions").delete().eq("message_id", parsed.data.message_id).eq("user_id", userId).eq("emoji", parsed.data.emoji)
    : await supabase.from("message_reactions").insert({ message_id: parsed.data.message_id, user_id: userId, emoji: parsed.data.emoji });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true };
}

export async function startDirect(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, org_slug: z.string().regex(slugRe), user_id: uuid }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a person." };
  const { supabase } = await me();
  const { data, error } = await supabase.rpc("start_direct_conversation", { p_org: parsed.data.organization_id, p_other: parsed.data.user_id });
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  redirect(`/o/${parsed.data.org_slug}/chat/${data}`);
}

const createSchema = z.object({
  organization_id: uuid,
  org_slug: z.string().regex(slugRe),
  type: z.enum(["group", "channel"]),
  name: z.string().trim().min(1, "Enter a name").max(80),
  topic: z.string().trim().max(300).optional(),
  audience: z.enum(["members", "organization", "team"]).default("members"),
  team_id: z.union([z.literal(""), uuid]).optional().transform((v) => v || null),
});

export async function createConversation(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const members = formData.getAll("members").map(String).filter((v) => uuid.safeParse(v).success);
  if (parsed.data.audience === "team" && !parsed.data.team_id) return { ok: false, error: "Choose a team." };
  const { supabase } = await me();
  const name = parsed.data.type === "channel" ? parsed.data.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "channel" : parsed.data.name;
  const { data, error } = await supabase.rpc("create_conversation", {
    p_org: parsed.data.organization_id,
    p_type: parsed.data.type,
    p_name: name,
    p_topic: parsed.data.topic ?? null,
    p_audience: parsed.data.type === "channel" ? parsed.data.audience : "members",
    p_team: parsed.data.team_id,
    p_members: members,
  });
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  redirect(`/o/${parsed.data.org_slug}/chat/${data}`);
}

export async function addMembers(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ organization_id: uuid, conversation_id: uuid }).safeParse(formObject(formData));
  const members = formData.getAll("members").map(String).filter((v) => uuid.safeParse(v).success);
  if (!parsed.success || !members.length) return { ok: false, error: "Choose at least one person." };
  const { supabase } = await me();
  const { error } = await supabase
    .from("conversation_members")
    .upsert(members.map((user_id) => ({ conversation_id: parsed.data.conversation_id, organization_id: parsed.data.organization_id, user_id })), { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true, message: "Added." };
}

export async function leaveConversation(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ conversation_id: uuid, org_slug: z.string().regex(slugRe) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown conversation." };
  const { supabase, userId } = await me();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { error } = await supabase.from("conversation_members").delete().eq("conversation_id", parsed.data.conversation_id).eq("user_id", userId);
  if (error) return { ok: false, error: friendlyDbError(error) };
  redirect(`/o/${parsed.data.org_slug}/chat`);
}

export async function toggleMute(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ conversation_id: uuid, organization_id: uuid, muted: z.enum(["1", "0"]) }).safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Unknown conversation." };
  const { supabase, userId } = await me();
  if (!userId) return { ok: false, error: "Sign in again." };
  // Members of open channels may not have a row yet; mark_conversation_read creates it.
  await supabase.rpc("mark_conversation_read", { p_conv: parsed.data.conversation_id });
  const { error } = await supabase
    .from("conversation_members")
    .update({ muted: parsed.data.muted === "1" })
    .eq("conversation_id", parsed.data.conversation_id)
    .eq("user_id", userId);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/o/[org]/chat/${parsed.data.conversation_id}`, "page");
  return { ok: true, message: parsed.data.muted === "1" ? "Muted." : "Unmuted." };
}
