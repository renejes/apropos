import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupBestOaUrl } from './unpaywall'

describe('Unpaywall-Locator', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('nimmt url_for_pdf vor der Landing-Page', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toContain('api.unpaywall.org/v2/10.5555/oa-test')
      expect(String(url)).toContain('email=')
      return {
        ok: true,
        json: async () => ({
          is_oa: true,
          best_oa_location: {
            url: 'https://example.org/article',
            url_for_pdf: 'https://arxiv.org/pdf/1706.03762',
            version: 'submittedVersion',
            host_type: 'repository',
          },
        }),
      }
    })
    const loc = await lookupBestOaUrl('10.5555/oa-test')
    expect(loc).toEqual({
      url: 'https://arxiv.org/pdf/1706.03762',
      version: 'submittedVersion',
      host_type: 'repository',
    })
  })

  it('liefert null ohne OA und bei HTTP-Fehler', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ is_oa: false, best_oa_location: null }),
    }))
    expect(await lookupBestOaUrl('10.5555/closed')).toBeNull()

    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }))
    expect(await lookupBestOaUrl('10.5555/gone')).toBeNull()
  })

  it('weist keine DOI ab, ohne das Netz zu fragen', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await lookupBestOaUrl('kein-doi')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
