/**
 * Key hierarchy and domain-separated subkey derivation
 * Implements HKDF-based key derivation using WebCrypto.
 * Domain separation prevents key reuse across distinct roles (Spec 31).
 */

export type KeyRole =
  | 'orbit:v1:attachment_key'
  | 'orbit:v1:group_sender_key'
  | 'orbit:v1:message_ratchet_key'
  | 'orbit:v1:device_linking_key'
  | 'orbit:v1:backup_encryption_key';

export interface EncryptedAttachment {
  ciphertextBase64: string;
  ivBase64: string;
  sha256DigestHex: string;
  byteLength: number;
}

export class KeyHierarchyManager {
  private crypto: Crypto;

  constructor() {
    this.crypto = globalThis.crypto;
    if (!this.crypto?.subtle) {
      throw new Error('WebCrypto subtle API is unavailable');
    }
  }

  /**
   * Derive a domain-separated 256-bit AES-GCM subkey from a master secret.
   */
  async deriveSubkey(
    masterKeyRaw: Uint8Array,
    role: KeyRole,
    salt: Uint8Array = new Uint8Array(16)
  ): Promise<CryptoKey> {
    const rawBuffer = masterKeyRaw.buffer.slice(
      masterKeyRaw.byteOffset,
      masterKeyRaw.byteOffset + masterKeyRaw.byteLength
    ) as ArrayBuffer;

    const baseKey = await this.crypto.subtle.importKey(
      'raw',
      rawBuffer,
      'HKDF',
      false,
      ['deriveKey']
    );

    const info = new TextEncoder().encode(role);
    const infoBuffer = info.buffer.slice(info.byteOffset, info.byteOffset + info.byteLength) as ArrayBuffer;
    const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;

    return await this.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBuffer,
        info: infoBuffer,
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt an attachment buffer with AES-256-GCM and compute its SHA-256 digest.
   */
  async encryptAttachment(
    plaintextBuffer: Uint8Array,
    key: CryptoKey
  ): Promise<EncryptedAttachment> {
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const dataBuffer = plaintextBuffer.buffer.slice(
      plaintextBuffer.byteOffset,
      plaintextBuffer.byteOffset + plaintextBuffer.byteLength
    ) as ArrayBuffer;

    const ciphertext = await this.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      dataBuffer
    );

    const digestBuffer = await this.crypto.subtle.digest('SHA-256', dataBuffer);
    const sha256DigestHex = Buffer.from(digestBuffer).toString('hex');

    return {
      ciphertextBase64: Buffer.from(ciphertext).toString('base64'),
      ivBase64: Buffer.from(iv).toString('base64'),
      sha256DigestHex,
      byteLength: plaintextBuffer.byteLength,
    };
  }

  /**
   * Decrypt an attachment buffer.
   */
  async decryptAttachment(
    encrypted: EncryptedAttachment,
    key: CryptoKey
  ): Promise<Uint8Array> {
    const iv = Buffer.from(encrypted.ivBase64, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertextBase64, 'base64');

    const decrypted = await this.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ciphertext
    );

    return new Uint8Array(decrypted);
  }
}
