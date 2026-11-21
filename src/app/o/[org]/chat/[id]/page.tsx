import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, Hash, Lock, Pin } from "lucide-react";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { getConversation, getConversationMembers, getInbox, getMessages } from "@/server/services/chat";
import { listPeople } from "@/server/services/people";
import { formatBytes } from "@/server/services/files";
import { addMembers, leaveConversation, toggleMute } from "@/server/actions/chat";
import { Inbox, conversationTitle } from "@/components/chat/inbox";
import { Composer } from "@/components/chat/composer";
import { OwnMessageMenu, PinButton, ReactionBar } from "@/components/chat/message-actions";
import { ScrollToBottom } from "@/components/chat/scroll-bottom";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { Avatar } from "@/components/ui/avatar";
import { ActionForm, InlineActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Panel } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Chat" };

function dayLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date(iso));
}
function timeLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

/** Renders text with links and @mentions highlighted; everything else is escaped by React. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+|@[\p{L}][\p{L}\p{N}'-]*)/gu);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">{p}</a>
        ) : p.startsWith("@") ? (
          <span key={i} className="rounded bg-brass-soft px-0.5 font-medium">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Annotates messages with day separators and editability (kept out of render for purity). */
function annotate<T extends { created_at: string }>(messages: T[], tz: string) {
  const now = Date.now();
  let lastDay = "";
  return messages.map((m) => {
    const day = dayLabel(m.created_at, tz);
    const showDay = day !== lastDay;
    lastDay = day;
    return { m, day, showDay, recent: now - Date.parse(m.created_at) < 24 * 3600 * 1000 };
  });
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ before?: string; q?: string; members?: string }>;
}) {
  const { org: slug, id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const conv = await getConversation(id);
  if (!conv || conv.organization_id !== ctx.org.id) notFound();

  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { p_conv: id });

  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? sp.before : undefined;
  const [inbox, people, members, { messages, hasMore }] = await Promise.all([
    getInbox(ctx.org.id),
    listPeople(ctx.org.id, { includeInactive: true }),
    getConversationMembers(id),
    getMessages(id, ctx.userId, { before, search: sp.q?.slice(0, 100) || undefined }),
  ]);
  const byId = new Map(people.map((p) => [p.userId, p]));
  const base = `/o/${ctx.org.slug}`;
  const me = members.find((m) => m.user_id === ctx.userId);
  const otherUser = conv.type === "direct" ? members.find((m) => m.user_id !== ctx.userId)?.user_id ?? null : null;
  const title = conversationTitle({ type: conv.type, name: conv.name, other_user: otherUser }, byId);
  const isOwner = me?.role === "owner";
  const canModerate = conv.type === "channel" && ctx.perms.hasAnyScope("chat.channel.moderate");
  const pinned = messages.filter((m) => m.pinned_at && !m.deleted_at);
  const memberIds = new Set(members.map((m) => m.user_id));
  const addable = people.filter((p) => p.status === "active" && !memberIds.has(p.userId));
  const showMembers = sp.members === "1";
  const latest = messages.at(-1)?.id ?? "none";
  const otherPerson = otherUser ? byId.get(otherUser) : undefined;

  const rows = annotate(messages, ctx.profile.timezone);
  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:mx-0 lg:mt-0">
      <LiveRefresh table="messages" channel={`conv-${id}`} filter={`conversation_id=eq.${id}`} />
      <div className="lg:grid lg:grid-cols-[20rem_1fr] lg:gap-6">
        <Panel className="hidden max-h-[calc(100dvh-6rem)] overflow-y-auto lg:block">
          <Inbox items={inbox} people={byId} base={base} activeId={id} timeZone={ctx.profile.timezone} />
        </Panel>

        <section className="flex h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden bg-panel lg:h-[calc(100dvh-6rem)] lg:rounded-lg lg:border lg:border-line" aria-label={title}>
          <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
            <Link href={`${base}/chat`} className="rounded p-1 lg:hidden" aria-label="All conversations">
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
            {conv.type === "direct" ? (
              <Avatar id={otherUser ?? id} name={title} src={otherPerson?.avatarUrl} size="sm" inactive={otherPerson ? otherPerson.status !== "active" : true} />
            ) : (
              <Hash className="size-5 text-ink-muted" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              <p className="truncate text-xs text-ink-muted">
                {conv.type === "direct" ? (
                  <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden /> Private conversation</span>
                ) : conv.audience === "organization" ? `Everyone in ${ctx.org.name}${conv.topic ? ` · ${conv.topic}` : ""}` : conv.topic ?? `${members.length} members`}
              </p>
            </div>
            <form className="hidden sm:block" action={`${base}/chat/${id}`}>
              <label className="sr-only" htmlFor="chat-search">Search this conversation</label>
              <input id="chat-search" name="q" defaultValue={sp.q} placeholder="Search" className="h-8 w-36 rounded-md border border-line bg-panel px-2 text-sm" />
            </form>
            {conv.type !== "direct" ? (
              <Link href={showMembers ? `${base}/chat/${id}` : `${base}/chat/${id}?members=1`} className="text-sm underline-offset-4 hover:underline">
                {showMembers ? "Close" : "Members"}
              </Link>
            ) : null}
          </header>

          {showMembers ? (
            <div className="space-y-4 overflow-y-auto p-4">
              <ul className="space-y-2">
                {conv.audience !== "members" ? (
                  <li className="text-sm text-ink-muted">
                    {conv.audience === "organization" ? "Everyone in the organization can read and post here." : "Everyone in the team can read and post here."}
                  </li>
                ) : null}
                {members.map((m) => {
                  const p = byId.get(m.user_id);
                  return (
                    <li key={m.user_id} className="flex items-center gap-2 text-sm">
                      <Avatar id={m.user_id} name={p?.name ?? "?"} src={p?.avatarUrl} size="xs" />
                      {p?.name ?? "Former colleague"} {m.role === "owner" ? <span className="text-xs text-ink-muted">(owner)</span> : null}
                    </li>
                  );
                })}
              </ul>
              {(isOwner || canModerate) && addable.length ? (
                <ActionForm action={addMembers} className="space-y-2">
                  <input type="hidden" name="organization_id" value={ctx.org.id} />
                  <input type="hidden" name="conversation_id" value={id} />
                  <p className="text-sm font-medium">Add people</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                    {addable.map((p) => (
                      <label key={p.userId} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="members" value={p.userId} className="size-4" /> {p.name}
                      </label>
                    ))}
                  </div>
                  <SubmitButton size="sm" variant="secondary">Add</SubmitButton>
                </ActionForm>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <InlineActionForm action={toggleMute}>
                  <input type="hidden" name="organization_id" value={ctx.org.id} />
                  <input type="hidden" name="conversation_id" value={id} />
                  <input type="hidden" name="muted" value={me?.muted ? "0" : "1"} />
                  <SubmitButton size="sm" variant="secondary">{me?.muted ? "Unmute notifications" : "Mute notifications"}</SubmitButton>
                </InlineActionForm>
                {me && conv.audience === "members" ? (
                  <InlineActionForm action={leaveConversation} confirm="Leave this conversation?">
                    <input type="hidden" name="conversation_id" value={id} />
                    <input type="hidden" name="org_slug" value={ctx.org.slug} />
                    <SubmitButton size="sm" variant="ghost">Leave</SubmitButton>
                  </InlineActionForm>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {pinned.length ? (
                <div className="border-b border-line bg-brass-soft/50 px-4 py-2 text-sm">
                  {pinned.slice(-2).map((m) => (
                    <p key={m.id} className="flex items-center gap-2 truncate">
                      <Pin className="size-3.5 shrink-0" aria-label="Pinned" /> <span className="truncate">{m.body || "Attachment"}</span>
                    </p>
                  ))}
                </div>
              ) : null}
              <ol className="flex-1 space-y-1 overflow-y-auto px-3 py-3 sm:px-4" aria-live="polite">
                {hasMore ? (
                  <li className="pb-2 text-center">
                    <Link href={`${base}/chat/${id}?before=${encodeURIComponent(messages[0].created_at)}`} className="text-sm underline">Load earlier messages</Link>
                  </li>
                ) : null}
                {before ? (
                  <li className="pb-2 text-center"><Link href={`${base}/chat/${id}`} className="text-sm underline">Back to latest</Link></li>
                ) : null}
                {sp.q ? <li className="pb-2 text-center text-sm text-ink-muted">Results for “{sp.q}” · <Link className="underline" href={`${base}/chat/${id}`}>Clear</Link></li> : null}
                {!messages.length ? (
                  <li className="py-10 text-center text-sm text-ink-muted">{sp.q ? "No messages match." : "No messages yet. Say hello."}</li>
                ) : null}
                {rows.map(({ m, day, showDay, recent }) => {
                  const author = byId.get(m.author_id);
                  const mine = m.author_id === ctx.userId;
                  return (
                    <li key={m.id} id={`m-${m.id}`}>
                      {showDay ? <p className="my-3 text-center text-xs font-medium text-ink-muted">{day}</p> : null}
                      <div className="group flex gap-3 rounded-md px-1 py-1.5 hover:bg-panel-sunk/60">
                        <Avatar id={m.author_id} name={author?.name ?? "Former colleague"} src={author?.avatarUrl} size="sm" inactive={author ? author.status !== "active" : true} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-semibold">{author?.name ?? "Former colleague"}</span>
                            <time className="text-xs text-ink-muted tabular" dateTime={m.created_at}>{timeLabel(m.created_at, ctx.profile.timezone)}</time>
                            {m.edited_at && !m.deleted_at ? <span className="text-xs text-ink-muted">(edited)</span> : null}
                            {m.pinned_at ? <Pin className="size-3 text-brass" aria-label="Pinned" /> : null}
                          </p>
                          {m.deleted_at ? (
                            <p className="text-sm italic text-ink-muted">Message deleted</p>
                          ) : (
                            <>
                              {m.body ? <p className="whitespace-pre-wrap break-words text-[0.9375rem]"><RichText text={m.body} /></p> : null}
                              {m.attachments.length ? (
                                <ul className="mt-2 flex flex-wrap gap-2">
                                  {m.attachments.map((a) =>
                                    a.mime_type.startsWith("image/") ? (
                                      <li key={a.id}>
                                        <a href={`/files/${a.id}`} target="_blank" rel="noopener">
                                          {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked redirect */}
                                          <img src={`/files/${a.id}`} alt={a.file_name} className="max-h-60 max-w-full rounded-md border border-line object-contain sm:max-w-sm" loading="lazy" />
                                        </a>
                                      </li>
                                    ) : (
                                      <li key={a.id}>
                                        <a href={`/files/${a.id}?download=1`} className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm hover:bg-panel-sunk">
                                          <FileText className="size-4 text-ink-muted" aria-hidden />
                                          <span className="max-w-48 truncate">{a.file_name}</span>
                                          <span className="text-xs text-ink-muted">{formatBytes(a.size_bytes)}</span>
                                        </a>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              ) : null}
                              <ReactionBar messageId={m.id} conversationId={id} reactions={m.reactions} />
                              {mine ? (
                                <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                  <OwnMessageMenu messageId={m.id} conversationId={id} body={m.body} canEdit={recent} pinned={Boolean(m.pinned_at)} />
                                </div>
                              ) : (
                                <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                  <PinButton messageId={m.id} conversationId={id} pinned={Boolean(m.pinned_at)} />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
                <li><ScrollToBottom marker={latest} /></li>
              </ol>
              {conv.archived_at ? (
                <p className="border-t border-line p-4 text-sm text-ink-muted">This conversation is archived.</p>
              ) : conv.type === "direct" && otherPerson && otherPerson.status !== "active" ? (
                <p className="border-t border-line p-4 text-sm text-ink-muted">{otherPerson.name} no longer has access, so you can&apos;t reply.</p>
              ) : (
                <Composer orgId={ctx.org.id} conversationId={id} placeholder={conv.type === "direct" ? `Message ${title}` : `Message ${title}`} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
