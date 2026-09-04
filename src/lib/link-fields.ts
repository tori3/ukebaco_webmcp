/**
 * Ukebaco リンクの項目定義の正規化。
 *
 * リンク作成 API とプレビューの両方で同じ整形を通し、
 * 「プレビューで見た形」と「作成される形」がずれないようにする。
 */

import type { LinkField } from './types'

const FIELD_TYPES = new Set(['text', 'email', 'tel', 'textarea', 'select'])

/**
 * 「選択肢」の入力欄(1 行)を配列にする。
 * 区切りは読点・カンマ・改行のどれでもよい。前後の空白と空の要素、重複は落とす。
 */
export function parseOptions(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/[,、\n]/)
    .map((o) => o.trim().slice(0, 80))
    .filter((o) => o !== '' && !seen.has(o) && seen.add(o) !== undefined)
    .slice(0, 30)
}

/** 画面から届いた項目定義を検証し、想定外の値を落とす */
export function normalizeFields(input: unknown): LinkField[] {
  if (!Array.isArray(input)) return []

  return input.slice(0, 20).flatMap((raw): LinkField[] => {
    const field = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const id = String(field.id ?? '').trim()
    const label = String(field.label ?? '').trim()

    // テンプレートで {field:id} として参照するため、扱いやすい文字だけに限る
    if (!/^[a-z0-9_]{1,32}$/i.test(id) || label === '') return []

    const type = (FIELD_TYPES.has(String(field.type)) ? field.type : 'text') as LinkField['type']
    const options =
      type === 'select' && Array.isArray(field.options)
        ? field.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 30)
        : undefined

    return [
      {
        id,
        label: label.slice(0, 80),
        type,
        required: field.required === true,
        ...(options ? { options } : {}),
      },
    ]
  })
}
