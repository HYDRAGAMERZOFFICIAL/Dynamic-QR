export type QRStatus = 'active' | 'paused' | 'archived'
export type QRDesign = {
  style: 'square' | 'dots' | 'rounded'
  foreground: string
  background: string
  corner: 'square' | 'extra-rounded' | 'dot'
  frame: 'none' | 'scan' | 'badge'
}
export type QRLink = { id: string; label: string; url: string }
export type QRFile = { id: string; name: string; type: string; size: number; dataUrl?: string; storagePath?: string }
export type QRContent = {
  name: string
  headline: string
  bio: string
  email: string
  phone: string
  website: string
  location: string
  links: QRLink[]
  files: QRFile[]
  sections: { id: string; title: string; body: string }[]
}
export type QRRecord = {
  id: string
  slug: string
  title: string
  status: QRStatus
  design: QRDesign
  draft: QRContent
  published: QRContent
  password?: string
  createdAt: string
  publishedAt?: string
  scans: number
}
export const emptyContent = (): QRContent => ({
  name: '', headline: '', bio: '', email: '', phone: '', website: '', location: '',
  links: [], files: [], sections: [],
})
export const defaultDesign: QRDesign = {
  style: 'square', foreground: '#17152b', background: '#ffffff', corner: 'extra-rounded', frame: 'scan',
}
