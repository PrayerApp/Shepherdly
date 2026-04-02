import { decrypt } from './crypto'

export interface PcoCredentials {
  appId: string
  appSecret: string
}

/**
 * PCO API v2 client with automatic rate-limit handling.
 * Uses Personal Access Token (basic auth).
 */
export class PcoClient {
  private auth: string

  constructor(creds: PcoCredentials) {
    this.auth = 'Basic ' + Buffer.from(`${creds.appId}:${creds.appSecret}`).toString('base64')
  }

  /** Make a GET request to PCO API, handling rate limits automatically. */
  async get(path: string, params?: Record<string, string>): Promise<any> {
    const url = new URL(`https://api.planningcenteronline.com${path}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    }

    let retries = 0
    while (retries < 3) {
      const res = await fetch(url.toString(), {
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      })

      if (res.status === 429) {
        // Rate limited — respect Retry-After header
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10)
        const waitMs = Math.min(retryAfter * 1000, 30000)
        await new Promise(r => setTimeout(r, waitMs))
        retries++
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`PCO API ${res.status}: ${body.substring(0, 200)}`)
      }

      return res.json()
    }

    throw new Error('PCO API: max retries exceeded (rate limited)')
  }

  /** Validate credentials by hitting the org endpoint */
  async validate(): Promise<{ valid: boolean; orgName?: string; error?: string }> {
    try {
      const data = await this.get('/people/v2')
      return {
        valid: true,
        orgName: data?.data?.attributes?.name || undefined,
      }
    } catch (e: any) {
      return { valid: false, error: e.message }
    }
  }

  /**
   * Paginate through all results for a given endpoint.
   * Calls onPage with each page of data. Returns total record count.
   */
  async paginate(
    path: string,
    params: Record<string, string>,
    onPage: (data: any[], meta: any) => Promise<void>,
  ): Promise<number> {
    let offset = 0
    let total = 0
    const perPage = params.per_page || '100'

    while (true) {
      const result = await this.get(path, { ...params, per_page: perPage, offset: String(offset) })
      const data = result.data || []
      total += data.length

      if (data.length > 0) {
        await onPage(data, result.meta)
      }

      // Check for next page
      if (!result.links?.next || data.length === 0) break
      offset += data.length
    }

    return total
  }
}

/** Build a PcoClient from encrypted DB credentials */
export function createPcoClient(encAppId: string, encAppSecret: string): PcoClient {
  let appId: string, appSecret: string
  try {
    appId = decrypt(encAppId)
    appSecret = decrypt(encAppSecret)
  } catch {
    // Credentials might not be encrypted yet (legacy plaintext)
    appId = encAppId
    appSecret = encAppSecret
  }
  return new PcoClient({ appId, appSecret })
}
