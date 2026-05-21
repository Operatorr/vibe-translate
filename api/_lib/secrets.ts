// AES-GCM encryption for at-rest secrets (BYOK OpenRouter keys).
// Storage format: base64(iv) + ':' + base64(ciphertext). The IV is 12 bytes
// (96 bits, GCM standard). The key is a 32-byte secret loaded from
// CREDENTIALS_ENCRYPTION_KEY (base64) at request time.
//
// Rotation: changing CREDENTIALS_ENCRYPTION_KEY requires re-encrypting every
// stored cipher. See SECURITY.md.

const IV_BYTES = 12

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyBase64.trim())
  if (raw.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes')
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptSecret(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)))
  const encoded = new TextEncoder().encode(plaintext)
  const data = new Uint8Array(new ArrayBuffer(encoded.byteLength))
  data.set(encoded)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data),
  )
  return `${bytesToBase64(iv)}:${bytesToBase64(cipher)}`
}

export async function decryptSecret(cipherText: string, keyBase64: string): Promise<string> {
  const [ivPart, dataPart] = cipherText.split(':', 2)
  if (!ivPart || !dataPart) throw new Error('Malformed cipher text')
  const key = await importKey(keyBase64)
  const iv = base64ToBytes(ivPart)
  const data = base64ToBytes(dataPart)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(plain)
}

export function lastFour(value: string): string {
  return value.slice(-4)
}
