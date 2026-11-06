"use client";

// DropdownMenu, on Radix: keyboard, focus return, typeahead and collision
// handling come with it. Items are links or actions; a danger item says so.
import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "./cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;
export const MenuRadioGroup = M.RadioGroup;

export const menuSurface =
  "z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-surface p-1 text-sm text-fg shadow-menu data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

export function MenuContent({ className, sideOffset = 6, align = "end", ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset} align={align} className={cn(menuSurface, "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto", className)} {...props} />
    </M.Portal>
  );
}

export const menuItemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-secondary outline-none transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted";

export function MenuItem({ className, tone, ...props }: React.ComponentProps<typeof M.Item> & { tone?: "danger" }) {
  return (
    <M.Item
      className={cn(menuItemClass, tone === "danger" && "text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger [&_svg]:text-danger", className)}
      {...props}
    />
  );
}

export function MenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(menuItemClass, "pr-8", className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-2 inline-flex">
        <Check />
      </M.ItemIndicator>
    </M.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2 pb-1 pt-1.5 text-xs font-medium text-fg-muted", className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("-mx-1 my-1 h-px bg-line-faint", className)} {...props} />;
}

export function MenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("ml-auto pl-4 text-xs text-fg-subtle", className)} {...props} />;
}
