"use client";

// Select: a choice from a list, on Radix — keyboard, typeahead, focus and
// collision handling, drawn in the kit's box instead of the browser's own
// menu (owner rule: no browser controls in the UI).
//
// It reads the same as a native <select> so forms stay plain: <option> and
// <optgroup> children, `value` / `defaultValue`, `onChange(e)` with
// `e.target.value`, `name` (a hidden input carries the chosen value, an
// empty choice as "", so GET forms and FormData still work),
// `required`, `disabled`, `id`, `aria-label`. `onValueChange(v)` is there too.
//
// An empty value ("" — "All", "Not set") is a real choice here; Radix does
// not allow it, so it is carried under a private key and handed back as "".
import * as React from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { inputBase } from "./input";

const EMPTY = "\u0000none";
const toKey = (v: string) => (v === "" ? EMPTY : v);
const fromKey = (k: string) => (k === EMPTY ? "" : k);

type Opt = { value: string; label: React.ReactNode; text: string; disabled?: boolean };
type Group = { label: React.ReactNode | null; options: Opt[] };

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** <option>/<optgroup> children (through fragments and arrays) as groups. */
function read(children: React.ReactNode): Group[] {
  const groups: Group[] = [{ label: null, options: [] }];
  const walk = (node: React.ReactNode, into: Group) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === React.Fragment) return walk((child.props as { children?: React.ReactNode }).children, into);
      if (child.type === "optgroup") {
        const p = child.props as { label?: React.ReactNode; children?: React.ReactNode };
        const g: Group = { label: p.label ?? null, options: [] };
        groups.push(g);
        walk(p.children, g);
        return;
      }
      if (child.type === "option") {
        const p = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean; label?: string };
        const label = p.children ?? p.label ?? String(p.value ?? "");
        const value = p.value !== undefined ? String(p.value) : textOf(label);
        into.options.push({ value, label, text: textOf(label) || value, disabled: p.disabled });
      }
    });
  };
  walk(children, groups[0]);
  return groups.filter((g) => g.options.length || g.label);
}

export type SelectChange = { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } };

export function Select({
  value,
  defaultValue,
  onChange,
  onValueChange,
  name,
  required,
  disabled,
  id,
  placeholder,
  className,
  selectClassName,
  size = "md",
  children,
  autoFocus,
  ...aria
}: {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: SelectChange) => void;
  onValueChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  /** Shown while nothing is chosen. */
  placeholder?: React.ReactNode;
  /** Places and sizes the box (width, margin). */
  className?: string;
  /** Reaches the trigger itself (text size, weight). */
  selectClassName?: string;
  size?: "sm" | "md";
  children?: React.ReactNode;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  title?: string;
}) {
  const groups = read(children);
  const all = groups.flatMap((g) => g.options);
  const current = value !== undefined ? String(value) : undefined;
  const shown = current !== undefined ? all.find((o) => o.value === current) : undefined;
  const { title, ...ariaRest } = aria;
  // What a <form> submits. Radix's own hidden select would send the internal
  // key, so an empty choice ("Everything", "Any") went out as the sentinel
  // and a GET filter matched nothing (Codex review). The decoded value goes
  // in a hidden input of our own; uncontrolled, it follows the last pick.
  const [picked, setPicked] = React.useState(defaultValue !== undefined ? String(defaultValue) : "");
  const submitted = current ?? picked;
  return (
    <S.Root
      value={current !== undefined ? toKey(current) : undefined}
      defaultValue={defaultValue !== undefined ? toKey(String(defaultValue)) : undefined}
      onValueChange={(k) => {
        const v = fromKey(k);
        setPicked(v);
        onValueChange?.(v);
        onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } });
      }}
      required={required}
      disabled={disabled}
    >
      <span data-slot="select" className={cn("relative inline-flex min-w-0", className)}>
        {name && <input type="hidden" name={name} value={submitted} disabled={disabled} />}
        <S.Trigger
          id={id}
          autoFocus={autoFocus}
          aria-label={ariaRest["aria-label"] ?? title}
          aria-labelledby={ariaRest["aria-labelledby"]}
          aria-describedby={ariaRest["aria-describedby"]}
          aria-invalid={ariaRest["aria-invalid"]}
          className={cn(
            inputBase,
            "inline-flex items-center justify-between gap-2 py-0 pl-3 pr-2 text-left data-[placeholder]:text-fg-subtle",
            size === "sm" ? "h-8 text-[13px]" : "h-9",
            selectClassName,
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            <S.Value placeholder={placeholder ?? (shown ? undefined : "")}>{shown?.label}</S.Value>
          </span>
          <S.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
          </S.Icon>
        </S.Trigger>
      </span>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-[70] max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-line bg-surface text-sm text-fg shadow-menu data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <S.ScrollUpButton className="flex h-6 items-center justify-center text-fg-muted">
            <ChevronDown className="size-4 rotate-180" aria-hidden />
          </S.ScrollUpButton>
          <S.Viewport className="p-1">
            {groups.map((g, gi) => (
              <S.Group key={gi}>
                {g.label != null && <S.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-fg-muted">{g.label}</S.Label>}
                {g.options.map((o) => (
                  <S.Item
                    key={o.value}
                    value={toKey(o.value)}
                    textValue={o.text}
                    disabled={o.disabled}
                    className="relative flex cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm text-fg-secondary outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[highlighted]:text-fg data-[disabled]:opacity-50 data-[state=checked]:text-fg"
                  >
                    <S.ItemText>{o.label}</S.ItemText>
                    <S.ItemIndicator className="absolute right-2 inline-flex">
                      <Check className="size-4" aria-hidden />
                    </S.ItemIndicator>
                  </S.Item>
                ))}
              </S.Group>
            ))}
          </S.Viewport>
          <S.ScrollDownButton className="flex h-6 items-center justify-center text-fg-muted">
            <ChevronDown className="size-4" aria-hidden />
          </S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
