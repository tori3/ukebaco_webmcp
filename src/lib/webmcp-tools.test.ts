import { describe, expect, it } from 'vitest'
import {
  buildCreateLinkBody,
  fieldIdFromLabel,
  parseDeadline,
  webMcpToolDefinitions,
  WEBMCP_TOOL_NAMES,
} from './webmcp-tools'
import { normalizeFields } from './link-fields'

describe('fieldIdFromLabel', () => {
  it('uses ascii labels as ids', () => {
    expect(fieldIdFromLabel('Company Name', new Set())).toBe('company_name')
  })

  it('numbers labels that leave nothing usable', () => {
    const taken = new Set<string>()
    expect(fieldIdFromLabel('会社名', taken)).toBe('f1')
    expect(fieldIdFromLabel('ご担当者名', taken)).toBe('f2')
  })

  it('avoids collisions', () => {
    const taken = new Set<string>()
    expect(fieldIdFromLabel('Name', taken)).toBe('name')
    expect(fieldIdFromLabel('name', taken)).toBe('name_2')
  })
})

describe('buildCreateLinkBody', () => {
  it('turns Japanese labels into ids the links API accepts', () => {
    const result = buildCreateLinkBody({
      title: '2026 年 9 月分の請求書',
      folderName: '請求書',
      fields: [
        { label: '会社名', required: true },
        { label: 'ご担当者名' },
        { label: 'メールアドレス', type: 'email' },
      ],
      folderBy: ['会社名', 'date'],
      filenameField: '会社名',
      allowedExtensions: ['pdf', '.PNG'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.folderName).toBe('請求書')
    expect(result.body.fields.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(result.body.fields[0]).toMatchObject({ label: '会社名', type: 'text', required: true })
    expect(result.body.fields[2]?.type).toBe('email')
    expect(result.body.folderTemplates).toEqual(['{field:f1}', '{date}'])
    expect(result.body.nameTemplate).toBe('{timestamp}_{field:f1}_{original}')
    expect(result.body.allowedExtensions).toEqual(['.pdf', '.png'])
    expect(result.body.maxFilesPerSubmission).toBe(10)
    expect(result.body.pin).toBeUndefined()
    expect(result.body.expiresAt).toBeUndefined()

    // API 側の正規化を通しても項目が落ちない
    expect(normalizeFields(result.body.fields)).toHaveLength(3)
  })

  it('defaults the folder name to the title', () => {
    const result = buildCreateLinkBody({ title: '発表会の写真' })
    expect(result).toMatchObject({ ok: true, folderName: '発表会の写真' })
    if (!result.ok) return
    expect(result.body.fields).toEqual([])
    expect(result.body.folderTemplates).toEqual([])
    expect(result.body.nameTemplate).toBe('{timestamp}_{original}')
  })

  it('rejects an unknown folderBy reference so the agent can correct it', () => {
    const result = buildCreateLinkBody({
      title: 'x',
      fields: [{ label: '会社名' }],
      folderBy: ['部署名'],
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('部署名') })
  })

  it('rejects long text fields as folder or file names', () => {
    const result = buildCreateLinkBody({
      title: 'x',
      fields: [{ label: '備考', type: 'textarea' }],
      folderBy: ['備考'],
    })
    expect(result.ok).toBe(false)
  })

  it('requires options for a select field', () => {
    const result = buildCreateLinkBody({
      title: 'x',
      fields: [{ label: '種別', type: 'select' }],
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('種別') })
  })

  it('validates the pin and keeps the receipt email tied to verification', () => {
    expect(buildCreateLinkBody({ title: 'x', pin: '12' }).ok).toBe(false)
    const result = buildCreateLinkBody({ title: 'x', pin: '1234', sendReceiptEmail: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.pin).toBe('1234')
    expect(result.body.requireEmailVerification).toBe(false)
    expect(result.body.sendReceiptEmail).toBe(false)
  })

  it('fails without a title', () => {
    expect(buildCreateLinkBody({ title: '  ' }).ok).toBe(false)
  })

  it('turns a deadline date into the end of that day', () => {
    const result = buildCreateLinkBody({ title: 'x', deadline: '2099-12-31' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expires = new Date(result.body.expiresAt!)
    expect(expires.getFullYear()).toBe(2099)
    expect(expires.getMonth()).toBe(11)
    expect(expires.getDate()).toBe(31)
    expect(expires.getHours()).toBe(23)
  })
})

describe('parseDeadline', () => {
  it('rejects the past and garbage', () => {
    expect(parseDeadline('2000-01-01')).toMatchObject({ error: expect.any(String) })
    expect(parseDeadline('next friday')).toMatchObject({ error: expect.any(String) })
  })
})

describe('webMcpToolDefinitions', () => {
  it('defines the four tools with object schemas', () => {
    const tools = webMcpToolDefinitions(90)
    expect(tools.map((t) => t.name)).toEqual(Object.values(WEBMCP_TOOL_NAMES))
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(20)
    }
  })

  it('marks the read-only tools and the one that returns submitter text', () => {
    const byName = new Map(webMcpToolDefinitions(90).map((t) => [t.name, t]))
    expect(byName.get('list_links')?.annotations).toEqual({ readOnlyHint: true })
    expect(byName.get('search_submissions')?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    })
    expect(byName.get('create_link')?.annotations).toBeUndefined()
    expect(byName.get('search_submissions')?.description).toContain('90 days')
  })
})
