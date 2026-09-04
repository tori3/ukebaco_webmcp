/**
 * WebMCP のツール定義と、エージェントからの入力の整形。
 *
 * WebMCP は、ページが自分の JS 関数をブラウザに「道具」として登録し、同じブラウザの中の
 * エージェント(Gemini in Chrome など)に呼ばせる仕組み。ダッシュボードで登録するので、
 * 認証は新しく作らない: 実行はオーナーがログイン済みのタブの中で行われ、fetch には
 * セッション Cookie が自動で付く。サーバー側の判定(本人確認・プランの上限・有料機能)は
 * 既存の API がそのまま行う。
 *
 * ここには通信を含めない(vitest で検証できる純粋な層)。登録と fetch は
 * components/WebMcpTools.tsx。
 *
 * 説明文は英語で書く。読むのはエージェント(モデル)で、利用者の言語に関わらず
 * 同じ定義を渡す。用語は「Ukebaco link」で統一する。
 */

import type { FieldType, LinkField } from './types'
import { PRODUCT_NAME } from './product'

/** エージェントが渡す項目。id は持たせない(ラベルから作る) */
export interface AgentField {
  label: string
  type?: string
  required?: boolean
  options?: string[]
}

export interface CreateLinkInput {
  title: string
  description?: string
  folderName?: string
  fields?: AgentField[]
  /** 項目のラベル、または "date"。順に最大 3 段 */
  folderBy?: string[]
  /** ファイル名に入れる項目のラベル */
  filenameField?: string
  /** 既定 true */
  prefixTimestamp?: boolean
  /** YYYY-MM-DD(その日の終わりまで)か ISO 8601 の日時 */
  deadline?: string
  pin?: string
  requireEmailVerification?: boolean
  sendReceiptEmail?: boolean
  allowedExtensions?: string[]
  maxFilesPerSubmission?: number
}

/** POST /api/links に渡す本文(folderId はフォルダ作成後に足す) */
export interface CreateLinkBody {
  title: string
  description: string
  fields: LinkField[]
  folderTemplates: string[]
  nameTemplate: string
  requireEmailVerification: boolean
  sendReceiptEmail: boolean
  allowedExtensions: string[]
  maxFilesPerSubmission: number
  pin?: string
  expiresAt?: string
}

export type BuildResult =
  | { ok: true; folderName: string; body: CreateLinkBody }
  | { ok: false; error: string }

const FIELD_TYPES = new Set<FieldType>(['text', 'email', 'tel', 'textarea', 'select'])
const MAX_FOLDER_LEVELS = 3

/** 大文字小文字・全角半角の違いを吸収して比べる */
function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

/**
 * ラベルから項目 id を作る。API は id を `[a-z0-9_]{1,32}` に限るが、
 * エージェントは日本語のラベルを送ってくるので、英数字にならないものは連番にする。
 */
export function fieldIdFromLabel(label: string, taken: Set<string>): string {
  const ascii = normalizeKey(label)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  let candidate = ascii || `f${taken.size + 1}`
  let n = 2
  while (taken.has(candidate)) candidate = `${ascii || 'f'}_${n++}`.slice(0, 32)
  taken.add(candidate)
  return candidate
}

function normalizeAgentFields(input: AgentField[] | undefined): LinkField[] | { error: string } {
  const taken = new Set<string>()
  const fields: LinkField[] = []
  for (const raw of (input ?? []).slice(0, 20)) {
    const label = String(raw?.label ?? '').trim().slice(0, 80)
    if (!label) continue
    const type = FIELD_TYPES.has(raw.type as FieldType) ? (raw.type as FieldType) : 'text'
    const options =
      type === 'select'
        ? (raw.options ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 30)
        : undefined
    if (type === 'select' && (!options || options.length === 0)) {
      return { error: `Field "${label}" is a select but has no options.` }
    }
    fields.push({
      id: fieldIdFromLabel(label, taken),
      label,
      type,
      required: raw.required === true,
      ...(options ? { options } : {}),
    })
  }
  return fields
}

/** ラベル(または id)で項目を探す。全角半角・大文字小文字は区別しない */
function findField(fields: LinkField[], ref: string): LinkField | undefined {
  const key = normalizeKey(ref)
  return fields.find((f) => normalizeKey(f.label) === key || normalizeKey(f.id) === key)
}

/** YYYY-MM-DD はその日の終わり(実行環境のタイムゾーン)、それ以外は Date に任せる */
export function parseDeadline(value: string): string | { error: string } {
  const text = value.trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T23:59:59`) : new Date(text)
  if (Number.isNaN(date.getTime())) {
    return { error: `Deadline "${value}" is not a date. Use YYYY-MM-DD.` }
  }
  if (date.getTime() <= Date.now()) {
    return { error: `Deadline "${value}" is already in the past.` }
  }
  return date.toISOString()
}

/**
 * エージェントの入力を、画面の LinkCreator が送るのと同じ形にする。
 * 画面と同じ既定(タイムスタンプ付き、元のファイル名は常に残す、1 回 10 ファイル)。
 */
export function buildCreateLinkBody(input: CreateLinkInput): BuildResult {
  const title = String(input.title ?? '').trim().slice(0, 120)
  if (!title) return { ok: false, error: 'title is required.' }

  const fields = normalizeAgentFields(input.fields)
  if ('error' in fields) return { ok: false, error: fields.error }

  const folderTemplates: string[] = []
  for (const ref of (input.folderBy ?? []).slice(0, MAX_FOLDER_LEVELS)) {
    const text = String(ref ?? '').trim()
    if (!text) continue
    if (normalizeKey(text) === 'date') {
      folderTemplates.push('{date}')
      continue
    }
    const field = findField(fields, text)
    if (!field) {
      return { ok: false, error: `folderBy refers to "${text}", which is not one of the fields.` }
    }
    if (field.type === 'textarea') {
      return { ok: false, error: `"${field.label}" is a long text field and cannot name a folder.` }
    }
    folderTemplates.push(`{field:${field.id}}`)
  }

  const nameParts: string[] = []
  if (input.prefixTimestamp !== false) nameParts.push('{timestamp}')
  if (input.filenameField) {
    const field = findField(fields, String(input.filenameField))
    if (!field) {
      return {
        ok: false,
        error: `filenameField refers to "${input.filenameField}", which is not one of the fields.`,
      }
    }
    if (field.type === 'textarea') {
      return { ok: false, error: `"${field.label}" is a long text field and cannot name a file.` }
    }
    nameParts.push(`{field:${field.id}}`)
  }
  nameParts.push('{original}')

  let expiresAt: string | undefined
  if (input.deadline) {
    const parsed = parseDeadline(String(input.deadline))
    if (typeof parsed !== 'string') return { ok: false, error: parsed.error }
    expiresAt = parsed
  }

  const pin = input.pin ? String(input.pin).trim() : ''
  if (pin && !/^\d{4,8}$/.test(pin)) {
    return { ok: false, error: 'pin must be 4 to 8 digits.' }
  }

  const requireEmailVerification = input.requireEmailVerification === true
  const allowedExtensions = (input.allowedExtensions ?? [])
    .map((e) => String(e).trim().toLowerCase())
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
    .filter((e) => /^\.[a-z0-9]{1,10}$/.test(e))
    .slice(0, 20)

  const folderName = String(input.folderName ?? '').trim().slice(0, 100) || title

  return {
    ok: true,
    folderName,
    body: {
      title,
      description: String(input.description ?? '').trim().slice(0, 1000),
      fields,
      folderTemplates,
      nameTemplate: nameParts.join('_'),
      requireEmailVerification,
      sendReceiptEmail: requireEmailVerification && input.sendReceiptEmail === true,
      allowedExtensions,
      maxFilesPerSubmission: Math.min(Math.max(Number(input.maxFilesPerSubmission) || 10, 1), 50),
      ...(pin ? { pin } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// ツール定義(registerTool に渡す、execute 以外の部分)
// ---------------------------------------------------------------------------

export interface JsonSchema {
  type: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: string[]
  minimum?: number
  maximum?: number
}

export interface WebMcpToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  annotations?: {
    /** 何も変更しない */
    readOnlyHint?: boolean
    /** 結果に第三者(提出者)が入力した文章が含まれる。指示として扱わないよう伝える */
    untrustedContentHint?: boolean
  }
}

export const WEBMCP_TOOL_NAMES = {
  listLinks: 'list_links',
  createLink: 'create_link',
  setLinkActive: 'set_link_active',
  searchSubmissions: 'search_submissions',
} as const

const LINK = `${PRODUCT_NAME} link`

/**
 * @param retentionDays 提出の記録が Firestore に残る日数。検索できる範囲として説明に入れる
 */
export function webMcpToolDefinitions(retentionDays: number): WebMcpToolDefinition[] {
  return [
    {
      name: WEBMCP_TOOL_NAMES.listLinks,
      description: `List the signed-in owner's ${LINK}s (file request pages). Returns each link's id, title, public URL, status, destination folder and ledger spreadsheet URL. Use it before creating a link to avoid duplicates, and to find a link id for other tools.`,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: WEBMCP_TOOL_NAMES.createLink,
      description: `Create a ${LINK}: a public page where anyone can upload files without a Google account. Files land in the owner's Google Drive, sorted into folders and renamed, and every submission is recorded in a ledger spreadsheet. Ask the owner what they want to collect (e.g. this month's invoices, event photos), from whom, and by when, then call this once. Returns the URL to share. Paid-plan features (pin, deadline, email verification) fail with an explanation when the plan does not allow them; relay that message.`,
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Name shown to submitters, e.g. "September 2026 invoices".',
          },
          description: {
            type: 'string',
            description: 'Instructions shown on the page, e.g. what to send and the deadline.',
          },
          folderName: {
            type: 'string',
            description:
              'Destination folder in the owner\'s My Drive. Created if missing, reused if a folder with the same name exists. Defaults to the title.',
          },
          fields: {
            type: 'array',
            description:
              'Questions the submitter answers before uploading. Default when omitted: none. Typical: company name and contact name.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Question label in the submitter\'s language.' },
                type: {
                  type: 'string',
                  enum: ['text', 'email', 'tel', 'textarea', 'select'],
                  description: 'Defaults to text.',
                },
                required: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Choices. Required when type is select.',
                },
              },
              required: ['label'],
            },
          },
          folderBy: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Subfolder levels under the destination, up to 3, each a field label or "date" (submission date). E.g. ["Company name"] puts each company\'s files in its own folder.',
          },
          filenameField: {
            type: 'string',
            description: 'Field label to prefix file names with, e.g. "Company name".',
          },
          prefixTimestamp: {
            type: 'boolean',
            description: 'Prefix file names with the submission timestamp. Default true.',
          },
          deadline: {
            type: 'string',
            description: 'Last day to accept submissions, YYYY-MM-DD (inclusive). Paid plans only.',
          },
          pin: {
            type: 'string',
            description: '4 to 8 digit code submitters must enter to open the page. Paid plans only.',
          },
          requireEmailVerification: {
            type: 'boolean',
            description: 'Verify the submitter\'s email address before upload. Paid plans only.',
          },
          sendReceiptEmail: {
            type: 'boolean',
            description: 'Email the submitter a receipt. Only with requireEmailVerification.',
          },
          allowedExtensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Accepted file extensions, e.g. [".pdf"]. Empty means any.',
          },
          maxFilesPerSubmission: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            description: 'Files per submission. Default 10.',
          },
        },
        required: ['title'],
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.setLinkActive,
      description: `Stop or resume a ${LINK}. A stopped link keeps its URL but refuses submissions. Resuming counts against the plan's active-link limit.`,
      inputSchema: {
        type: 'object',
        properties: {
          linkId: { type: 'string', description: 'Link id from list_links.' },
          active: { type: 'boolean', description: 'true to resume, false to stop.' },
        },
        required: ['linkId', 'active'],
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.searchSubmissions,
      description: `Search what has been submitted to the owner's ${LINK}s: who sent what, when, and the Drive URL of each file. Matches the query against submitter-entered fields (company, name, ...), folder path, receipt number and file names, case-insensitively; all words must match. Covers the last ${retentionDays} days; the ledger spreadsheet (URL in each result) holds the complete history. Use it to answer questions like "has company X sent this month's invoice?".`,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Words to look for, e.g. a company name. Omit to list the latest submissions.',
          },
          linkId: { type: 'string', description: 'Restrict to one link (id from list_links).' },
          since: {
            type: 'string',
            description: 'Only submissions on or after this date, YYYY-MM-DD.',
          },
          limit: { type: 'number', minimum: 1, maximum: 50, description: 'Default 20.' },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    },
  ]
}
