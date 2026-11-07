"use client";

// Combobox: a text box that suggests — type anything, or pick one of the
// known values (a timezone, a model tier, a limit key). The kit's stand-in
// for <input list> + <datalist> (owner rule: no browser controls in the UI),
// on Radix Popover. ArrowDown opens and moves, Enter picks, Escape closes;
// the list follows what is typed. The value stays free text.
import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "./cn";
import { Input } from "./input";

type InputProps = Omit<React.ComponentProps<"input">, "onChange" | "value" | "list">;

export function Combobox({
  options,
  value,
  onChange,
  className,
  id,
  max = 60,
  ...props
}: InputProps & {
  /** The suggestions. */
  options: readonly string[];
  value: string;
  /** Called as an input's would be: `e.target.value` is the new text. */
  onChange: (e: { target: { value: string } }) => void;
  /** How many suggestions to show at once. */
  max?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const auto = React.useId();
  const listId = `${id ?? auto}-list`;
  const needle = value.trim().toLowerCase();
  const shown = (needle && !options.some((o) => o.toLowerCase() === needle) ? options.filter((o) => o.toLowerCase().includes(needle)) : options).slice(0, max);
  const pick = (v: string) => {
    onChange({ target: { value: v } });
    setOpen(false);
  };
  const isOpen = open && shown.length > 0;
  return (
    <P.Root open={isOpen} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <span className={cn("relative block min-w-0", className?.match(/\b(w-|max-w-|flex-1|min-w-)\S+/g)?.join(" "))}>
          <Input
            {...props}
            id={id}
            value={value}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listId : undefined}
            aria-activedescendant={isOpen ? `${listId}-${Math.min(active, shown.length - 1)}` : undefined}
            autoComplete="off"
            className={cn("w-full", className?.replace(/\b(w-|max-w-|flex-1|min-w-)\S+/g, ""))}
            onChange={(e) => {
              onChange({ target: { value: e.target.value } });
              setActive(0);
              setOpen(true);
            }}
            onFocus={(e) => {
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              props.onBlur?.(e);
              setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!isOpen) setOpen(true);
                else setActive((a) => Math.min(shown.length - 1, a + 1));
              } else if (e.key === "ArrowUp" && isOpen) {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && isOpen && shown[active]) {
                e.preventDefault();
                pick(shown[active]);
              } else if (e.key === "Escape" && isOpen) {
                e.preventDefault();
                setOpen(false);
              } else props.onKeyDown?.(e);
            }}
          />
        </span>
      </P.Anchor>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-[70] max-h-64 w-(--radix-popover-trigger-width) min-w-48 overflow-y-auto rounded-lg border border-line bg-surface p-1 text-sm text-fg shadow-menu"
        >
          <ul id={listId} role="listbox">
            {shown.map((o, i) => (
              <li
                key={o}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn("cursor-default truncate rounded-md px-2 py-1.5 font-mono text-[13px] text-fg-secondary", i === active && "bg-muted text-fg")}
              >
                {o}
              </li>
            ))}
          </ul>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
