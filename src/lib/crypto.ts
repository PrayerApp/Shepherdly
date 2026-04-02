import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * Encrypt/decrypt PCO credentials using AES-256-GCM.
 * Derives key from SUPABASE_SERVICE_ROLE_KEY so no extra env var needed.
 */

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  return scryptSync(secret, 'shepherdly-pco', 32)
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt(encoded: string): string {
  const key = getKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

/** Check if a value looks like it's already encrypted (base64 of iv+tag+data) */
export function isEncrypted(value: string): boolean {
  if (!value) return false
  // Encrypted values are base64 and at least 28 bytes (12 iv + 16 tag)
  try {
    const buf = Buffer.from(value, 'base64')
    return buf.length >= 28 && value !== Buffer.from(value).toString('base64') === false
      && !/^[a-f0-9_]+$/i.test(value) // PCO tokens are hex/underscore
  } catch {
    return false
  }
}
