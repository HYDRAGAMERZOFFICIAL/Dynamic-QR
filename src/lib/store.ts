import { supabase } from './supabase'
import { defaultDesign, emptyContent, type QRContent, type QRDesign, type QRRecord } from '../types'

const STORAGE_KEY = 'dynamic-qr-workspace-v1'
type Stored = { qrs: QRRecord[] }
const demoSeed = (): QRRecord[] => [
  { id: crypto.randomUUID(), slug: 'x8k29p', title: 'Professional Profile', status: 'active', design: { ...defaultDesign }, draft: { ...emptyContent(), name: 'Sujith Kumar', headline: 'Developer · Technology', bio: 'Building digital experiences and exploring technology.', email: 'hello@example.com', website: 'https://example.com', links: [{ id: crypto.randomUUID(), label: 'LinkedIn', url: 'https://linkedin.com' }] }, published: { ...emptyContent(), name: 'Sujith Kumar', headline: 'Developer · Technology', bio: 'Building digital experiences and exploring technology.', email: 'hello@example.com', website: 'https://example.com', links: [{ id: crypto.randomUUID(), label: 'LinkedIn', url: 'https://linkedin.com' }] }, createdAt: new Date().toISOString(), publishedAt: new Date().toISOString(), scans: 842 },
]
function read(): Stored {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value) return JSON.parse(value) as Stored
  } catch { /* Reset malformed local demo data. */ }
  const seeded = { qrs: demoSeed() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}
function write(data: Stored) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }
const fromRow = (row: any): QRRecord => ({
  id: row.id, slug: row.slug, title: row.title, status: row.status, design: { ...defaultDesign, ...(row.design || {}) },
  draft: { ...emptyContent(), ...(row.draft_content || {}) }, published: { ...emptyContent(), ...(row.published_content || {}) },
  createdAt: row.created_at, publishedAt: row.published_at || undefined, scans: 0,
})
export type AnalyticsData = {
  totalScans: number
  qrCodes: { id: string; title: string; slug: string; scans: number }[]
  daily: { date: string; scans: number }[]
}

export async function getAnalytics(): Promise<AnalyticsData> {
  if (supabase) {
    const { data, error } = await supabase.rpc('get_qr_analytics')
    if (error) throw error
    return {
      totalScans: Number(data?.total_scans || 0),
      qrCodes: (data?.qr_codes || []).map((item: { qr_id: string; title: string; slug: string; scans: number }) => ({
        id: item.qr_id, title: item.title, slug: item.slug, scans: Number(item.scans || 0),
      })),
      daily: (data?.daily || []).map((item: { date: string; scans: number }) => ({ date: item.date, scans: Number(item.scans || 0) })),
    }
  }
  const qrs = read().qrs
  return { totalScans: qrs.reduce((sum, qr) => sum + qr.scans, 0), qrCodes: qrs.map(qr => ({ id: qr.id, title: qr.title, slug: qr.slug, scans: qr.scans })), daily: [] }
}

export async function listQrs(): Promise<QRRecord[]> {
  if (supabase) {
    const { data, error } = await supabase.from('qr_codes').select('*').order('created_at', { ascending: false })
    if (error) throw error
    const analytics = await getAnalytics()
    const counts = new Map(analytics.qrCodes.map(item => [item.id, item.scans]))
    return (data || []).map(row => ({ ...fromRow(row), scans: counts.get(row.id) || 0 }))
  }
  return read().qrs
}
export async function createQr(title: string, design: QRDesign, initialContent: QRContent = emptyContent()): Promise<QRRecord> {
  if (supabase) {
    const { data, error } = await supabase.rpc('create_qr', { p_title: title, p_design: design }).single()
    if (error) throw error
    const created = fromRow(data)
    const next = { ...created, draft: initialContent }
    await saveQr(next)
    return next
  }
  const state = read()
  if (state.qrs.filter(q => q.status === 'active').length >= 3) throw new Error('You can have up to three active QR codes. Pause or archive one to free a slot.')
  const record: QRRecord = { id: crypto.randomUUID(), slug: crypto.randomUUID().replaceAll('-', '').slice(0, 12), title: title.trim() || 'Untitled QR', status: 'active', design, draft: initialContent, published: emptyContent(), createdAt: new Date().toISOString(), scans: 0 }
  state.qrs.unshift(record); write(state); return record
}
export async function saveQr(qr: QRRecord): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('qr_codes').update({ title: qr.title, design: qr.design, draft_content: qr.draft, updated_at: new Date().toISOString() }).eq('id', qr.id)
    if (error) throw error
    return
  }
  const state = read(); state.qrs = state.qrs.map(item => item.id === qr.id ? qr : item); write(state)
}
export async function publishQr(qr: QRRecord): Promise<QRRecord> {
  if (supabase) {
    const { error: saveError } = await supabase.from('qr_codes').update({ title: qr.title, design: qr.design, draft_content: qr.draft }).eq('id', qr.id)
    if (saveError) throw saveError
    const { data, error } = await supabase.rpc('publish_qr', { p_qr_id: qr.id }).single()
    if (error) throw error
    return fromRow(data)
  }
  const next = { ...qr, published: structuredClone(qr.draft), publishedAt: new Date().toISOString() }
  await saveQr(next); return next
}
export async function setQrPassword(qr: QRRecord, password: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.rpc('set_qr_password', { p_qr_id: qr.id, p_password: password || null })
    if (error) throw error
    return
  }
  await saveQr({ ...qr, password: password || undefined })
}
export async function getPublicQr(slug: string, password?: string): Promise<{ qr?: QRRecord; passwordRequired?: boolean; invalidPassword?: boolean }> {
  if (supabase) {
    const { data, error } = await supabase.functions.invoke('public-qr-content', { body: { slug, password: password || null } })
    if (error) throw error
    if (!data) return {}
    if (data.password_required) return { passwordRequired: true, invalidPassword: Boolean(password) }
    return { qr: { id: slug, slug, title: data.title, status: 'active', design: { ...defaultDesign, ...(data.design || {}) }, draft: emptyContent(), published: { ...emptyContent(), ...(data.content || {}) }, createdAt: '', publishedAt: data.published_at, scans: 0 } }
  }
  const qr = read().qrs.find(item => item.slug === slug && item.status === 'active')
  if (!qr || !qr.publishedAt) return {}
  if (qr.password && qr.password !== password) return { passwordRequired: true, invalidPassword: Boolean(password) }
  const next = { ...qr, scans: qr.scans + 1 }
  await saveQr(next)
  return { qr: { ...next, draft: next.published } }
}
export async function updateStatus(qr: QRRecord, status: QRRecord['status']): Promise<void> {
  if (supabase) { const { error } = await supabase.rpc('set_qr_status', { p_qr_id: qr.id, p_status: status }); if (error) throw error; return }
  await saveQr({ ...qr, status })
}
export async function uploadAsset(qr: QRRecord, file: File): Promise<{ storagePath?: string; dataUrl?: string }> {
  const allowedTypes = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/webp',
  ])
  if (!allowedTypes.has(file.type)) throw new Error('Unsupported file type. Upload PDF, DOC, DOCX, PNG, JPG or WEBP files.')
  if (file.size > 25 * 1024 * 1024) throw new Error('Files must be 25 MB or smaller.')
  if (supabase) {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Please sign in before uploading files.')
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const storagePath = `${auth.user.id}/${qr.id}/${crypto.randomUUID()}-${safeName}`
    const { error } = await supabase.storage.from('qr-assets').upload(storagePath, file, { contentType: file.type, upsert: false })
    if (error) throw error
    const { error: metadataError } = await supabase.from('qr_files').insert({ qr_id: qr.id, owner_id: auth.user.id, storage_path: storagePath, file_name: file.name, mime_type: file.type, size_bytes: file.size })
    if (metadataError) {
      await supabase.storage.from('qr-assets').remove([storagePath])
      throw metadataError
    }
    return { storagePath }
  }
  if (file.size > 3 * 1024 * 1024) throw new Error('Demo mode supports files up to 3 MB. Configure Supabase Storage for larger files.')
  return { dataUrl: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) }) }
}
