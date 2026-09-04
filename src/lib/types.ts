/**
 * Minimal type shims for this extracted copy.
 *
 * In the product these live in `src/lib/db.ts` (the Firestore document shapes)
 * and `src/lib/i18n-app.ts` (the translated UI strings). Only the parts the
 * WebMCP layer actually touches are reproduced here.
 */

export type FieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select'

/** One question shown on the public upload page. */
export interface LinkField {
  id: string
  label: string
  type: FieldType
  required: boolean
  /** Choices, when type is 'select'. */
  options?: string[]
}

/** The one line the dashboard shows once the tools are registered. */
export interface WebMcpLabels {
  available: string
}
