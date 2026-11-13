import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError, errorMessage } from './api';

/**
 * Maps an API error onto a form: field errors land next to their inputs,
 * anything else becomes a toast. Returns true when at least one field error
 * was applied.
 */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, err: unknown): boolean {
  if (err instanceof ApiError && err.fieldErrors) {
    const known = Object.keys(form.getValues());
    let applied = false;
    for (const [key, message] of Object.entries(err.fieldErrors)) {
      if (known.includes(key)) {
        form.setError(key as Path<T>, { type: 'server', message });
        applied = true;
      }
    }
    if (applied) return true;
  }
  toast.error(errorMessage(err));
  return false;
}
