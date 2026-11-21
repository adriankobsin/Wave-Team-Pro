import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Link without background prefetching. Every page here is personalised and server-rendered, so
 * prefetching each visible link (five companies in the sidebar, profile, projects…) ran a dozen
 * full page renders per click and swamped the database. Pages now load when they're opened.
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
