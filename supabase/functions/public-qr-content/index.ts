import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  try {
    const { slug, password } = await request.json()
    if (typeof slug !== 'string' || !/^[a-zA-Z0-9-]{4,80}$/.test(slug)) {
      return Response.json({ error: 'Invalid QR destination' }, { status: 400, headers: cors })
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const publicClient = createClient(url, anonKey, { auth: { persistSession: false } })
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Password verification happens in the database before a signed asset URL is created.
    const { data, error } = await publicClient.rpc('get_qr_content', {
      p_slug: slug,
      p_password: typeof password === 'string' ? password : null,
    })
    if (error) throw error
    if (!data) return Response.json({ error: 'Destination unavailable' }, { status: 404, headers: cors })
    if (data.password_required) return Response.json(data, { headers: cors })

    const content = data.content ?? {}
    const files = Array.isArray(content.files) ? content.files : []
    const signedFiles = await Promise.all(files.map(async (file: Record<string, unknown>) => {
      const path = typeof file.storagePath === 'string' ? file.storagePath : ''
      if (!path) return file
      const { data: signed, error: signError } = await adminClient.storage.from('qr-assets').createSignedUrl(path, 600)
      return signError ? { ...file, signedUrl: null } : { ...file, signedUrl: signed.signedUrl }
    }))

    return Response.json({ ...data, content: { ...content, files: signedFiles } }, { headers: cors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return Response.json({ error: message }, { status: 500, headers: cors })
  }
})
