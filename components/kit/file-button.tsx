"use client";

// Picking files from the computer. The browser's file input is the one
// native piece the kit keeps — there is no other way to open the system's
// file chooser — and it is never shown: a kit Button opens it (owner rule:
// no browser controls in the UI).
//
//   useFilePicker   `open()` from any button, menu item or drop zone, and
//                   the hidden input to render once beside it
//   FileButton      a Button that picks, and says what was picked
import * as React from "react";
import { Button, type ButtonProps } from "./button";

export function useFilePicker({ accept, multiple = false, onFiles }: { accept?: string; multiple?: boolean; onFiles: (files: File[]) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

export function FileButton({
  accept,
  multiple,
  onFiles,
  children,
  chosen,
  ...props
}: Omit<ButtonProps, "onClick"> & {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  /** What was picked, shown beside the button. */
  chosen?: React.ReactNode;
}) {
  const picker = useFilePicker({ accept, multiple, onFiles });
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <Button {...props} onClick={picker.open}>
        {children}
      </Button>
      {chosen != null && <span className="min-w-0 truncate text-sm text-fg-secondary">{chosen}</span>}
      {picker.input}
    </span>
  );
}
