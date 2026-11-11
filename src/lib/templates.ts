import { emptyContent, type QRContent } from '../types'

export type QRTemplate = 'personal' | 'business' | 'social' | 'documents' | 'gallery' | 'links' | 'custom'

export const qrTemplates: { id: QRTemplate; title: string; description: string }[] = [
  { id: 'personal', title: 'Personal profile', description: 'Contact details and a short introduction' },
  { id: 'business', title: 'Business', description: 'Company, services and contact information' },
  { id: 'social', title: 'Social profile', description: 'Bring your social channels together' },
  { id: 'documents', title: 'Document hub', description: 'Share files, forms and resources' },
  { id: 'gallery', title: 'Image gallery', description: 'Create a destination for photos and media' },
  { id: 'links', title: 'Link collection', description: 'A clean page of useful destinations' },
  { id: 'custom', title: 'Start from scratch', description: 'Build your own custom QR destination' },
]

export function createTemplateContent(template: QRTemplate): QRContent {
  const content = emptyContent()
  switch (template) {
    case 'personal': return { ...content, headline: 'Personal profile' }
    case 'business': return { ...content, headline: 'Business · services', sections: [
      { id: crypto.randomUUID(), title: 'About our business', body: 'Introduce your business and what makes it different.' },
      { id: crypto.randomUUID(), title: 'Services', body: 'Add your products, services or key offerings.' },
    ] }
    case 'social': return { ...content, headline: 'Find me online', links: [
      { id: crypto.randomUUID(), label: 'Instagram', url: '' },
      { id: crypto.randomUUID(), label: 'LinkedIn', url: '' },
      { id: crypto.randomUUID(), label: 'YouTube', url: '' },
    ] }
    case 'documents': return { ...content, headline: 'Documents & resources', sections: [
      { id: crypto.randomUUID(), title: 'Resources', body: 'Upload PDFs, forms or other documents in the Files tab.' },
    ] }
    case 'gallery': return { ...content, headline: 'Photo & media gallery', sections: [
      { id: crypto.randomUUID(), title: 'Gallery', body: 'Upload your images in the Files tab to share them here.' },
    ] }
    case 'links': return { ...content, headline: 'Useful links', links: [{ id: crypto.randomUUID(), label: '', url: '' }] }
    case 'custom':
    default: return content
  }
}
