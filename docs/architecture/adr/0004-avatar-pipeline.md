# ADR 0004 — Avatar pipeline: server re-encoding, private bucket, signed URLs

Status: accepted (2026-10-20)

* Upload goes to a Server Action, never directly to Storage from the browser.
* The server checks size (≤ 8 MB) and the file signature (magic bytes via `file-type`) —
  filename and MIME header are ignored.
* `sharp` decodes, auto-orients, applies the user's crop/rotation, resizes to 512 px and
  128 px WebP, and writes **without metadata** (EXIF/GPS/XMP stripped). Decoding and
  re-encoding also neutralizes polyglot payloads, which is the malware control for images.
* Objects are written to the private `avatars` bucket at `<user_id>/<random>.webp` with the
  service role after the action has authenticated the user; the path prefix is derived from
  the session, never from input.
* Readers get 1-hour signed URLs created with *their own* client; the storage policy allows
  reading an avatar only when the reader shares an active organization with its owner.
* No avatar → initials avatar rendered client-side (no image request).
