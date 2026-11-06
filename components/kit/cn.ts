// One way to join class names: later classes win over earlier ones of the
// same kind (tailwind-merge), so a caller's override always takes.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
