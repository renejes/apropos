import { createHash } from 'crypto'
import type { Repo } from '../repo'
import { ServiceError } from './research'
import type { FetchedDocument } from '../../../shared/types'

const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export function parseYoutubeVideoId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      const fromQuery = url.searchParams.get('v')
      if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery
      const m = url.pathname.match(/\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})/)
      return m?.[1] ?? null
    }
  } catch {
    return null
  }
  return null
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) }
}

async function fetchText(url: string): Promise<string> {
  const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de,en;q=0.8' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    cancel()
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const text = await fetchText(url)
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\\n/g, '\n')
}

function timedtextToPlain(xml: string): string {
  const parts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeEntities(m[1]!.replace(/<[^>]+>/g, '')).trim())
  return parts.filter(Boolean).join('\n')
}

interface CaptionTrack {
  baseUrl?: string
  languageCode?: string
  kind?: string
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null
  const usable = tracks.filter((t) => t.baseUrl && t.kind !== 'asr')
  const pool = usable.length > 0 ? usable : tracks.filter((t) => t.baseUrl)
  const de = pool.find((t) => t.languageCode?.startsWith('de'))
  const en = pool.find((t) => t.languageCode?.startsWith('en'))
  return de ?? en ?? pool[0] ?? null
}

function tracksFromPlayer(player: unknown): CaptionTrack[] {
  if (!player || typeof player !== 'object') return []
  const rec = player as Record<string, unknown>
  const captions = rec.captions as Record<string, unknown> | undefined
  const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined
  const tracks = renderer?.captionTracks
  if (!Array.isArray(tracks)) return []
  return tracks.filter((t): t is CaptionTrack => !!t && typeof t === 'object')
}

function playerFromWatchHtml(html: string): unknown {
  const marker = 'ytInitialPlayerResponse'
  const idx = html.indexOf(marker)
  if (idx < 0) return null
  const start = html.indexOf('{', idx)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

async function captionTracksFor(videoId: string): Promise<CaptionTrack[]> {
  try {
    const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}`)
    const fromHtml = tracksFromPlayer(playerFromWatchHtml(html))
    if (fromHtml.length > 0) return fromHtml
  } catch {
    /* Player-API als Fallback */
  }
  try {
    const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS)
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20240827.00.00', hl: 'de' } },
          videoId,
        }),
      })
      if (!res.ok) return []
      return tracksFromPlayer(await res.json())
    } finally {
      cancel()
    }
  } catch {
    return []
  }
}

async function videoTitle(videoId: string, watchUrl: string): Promise<string> {
  const oembed = await fetchJson<{ title?: string }>(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`)
  if (oembed?.title?.trim()) return oembed.title.trim()
  return `YouTube ${videoId}`
}

export async function ingestYoutubeUrl(repo: Repo, projectId: string, urlOrId: string, actor: string): Promise<FetchedDocument> {
  const project = repo.getProject(projectId)
  if (!project) {
    throw new ServiceError('project_missing', `Projekt ${projectId} existiert nicht.`, 'Wähle ein vorhandenes Notebook.')
  }
  const videoId = parseYoutubeVideoId(urlOrId)
  if (!videoId) {
    throw new ServiceError(
      'youtube_url_invalid',
      'Das ist keine YouTube-URL (watch, youtu.be, shorts, embed).',
      'Füge einen Link der Form https://www.youtube.com/watch?v=… ein.'
    )
  }
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const existing = repo.listDocuments(projectId).find((d) => d.url === watchUrl && d.status !== 'excluded')
  if (existing) {
    const full = repo.getDocument(existing.id)
    if (full) return full
  }

  const tracks = await captionTracksFor(videoId)
  const track = pickTrack(tracks)
  if (!track?.baseUrl) {
    throw new ServiceError(
      'youtube_no_captions',
      'Für dieses Video gibt es keine Untertitel — ohne Transkript kann der Agent nicht zitieren.',
      'Wähle ein Video mit Untertiteln oder lade ein PDF/Transkript hoch.'
    )
  }
  const xml = await fetchText(track.baseUrl)
  const text = timedtextToPlain(xml).trim()
  if (!text) {
    throw new ServiceError(
      'youtube_empty_transcript',
      'Die Untertitelspur war leer.',
      'Wähle ein anderes Video oder lade den Text als Datei hoch.'
    )
  }
  const title = await videoTitle(videoId, watchUrl)
  return repo.addDocument({
    project_id: projectId,
    url: watchUrl,
    title,
    text,
    content_hash: createHash('sha256').update(text, 'utf8').digest('hex'),
    purpose: 'YouTube-Transkript (Untertitel)',
    actor,
    origin: 'youtube',
    status: 'used',
  })
}
