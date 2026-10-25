"use client";

// The one face for a person, a workspace or the account: the picture when
// there is one, the initial on ink when there is not. Every place that
// draws one draws this, at one of four sizes. AvatarEditor is the same
// face with Change and Remove under it, for the pages where it is yours
// to set.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "./ui";

const SIZE = {
  xs: "h-4 w-4 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-16 w-16 text-xl",
} as const;

export function Avatar({
  name,
  src,
  size = "md",
  square = false,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZE;
  /** A workspace is a folder, so its face is a rounded square; people and
   *  the account are circles. */
  square?: boolean;
  className?: string;
}) {
  const shape = square ? "rounded-md" : "rounded-full";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className={`${SIZE[size]} ${shape} shrink-0 object-cover ${className}`} />;
  }
  return (
    <span className={`${SIZE[size]} ${shape} flex shrink-0 select-none items-center justify-center bg-ink font-semibold text-on-ink ${className}`} aria-hidden>
      {(name[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function AvatarEditor({
  kind,
  id,
  name,
  src,
  tenant,
  square = false,
}: {
  kind: "user" | "workspace" | "account";
  id: string;
  name: string;
  src: string | null;
  tenant: string;
  square?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/avatars/${kind}/${encodeURIComponent(id)}`;
  const headers = { "x-foldrun-tenant": tenant };

  const upload = async (file: File) => {
    setError(null);
    if (file.size > 1024 * 1024) {
      setError("That image is over 1 MB.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: "PUT", headers: { ...headers, "content-type": file.type || "application/octet-stream" }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE", headers });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} src={src} size="xl" square={square} />
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClass("secondary", "!px-3 !py-1 !text-xs")}>
            {busy ? "Working…" : src ? "Change" : "Add a picture"}
          </button>
          {src && (
            <button type="button" disabled={busy} onClick={() => void remove()} className={buttonClass("minimal", "!px-2 !py-1 !text-xs")}>
              Remove
            </button>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </div>
        <p className="text-xs text-fg-subtle">PNG, JPEG or WebP, up to 1 MB. Square looks best.</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
