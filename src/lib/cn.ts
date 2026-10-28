import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The standard class-name helper for Tailwind components. Conditionally
 * composes via `clsx`, then resolves conflicting Tailwind utilities via
 * `tailwind-merge`. Pattern matches shadcn/ui conventions.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
