/**
 * WebCrypto-backed audited cryptographic adapter.
 * Uses standard AES-256-GCM and SHA-256 via W3C Web Cryptography API.
 */

export interface DeviceKeys {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  registeredAt: Date;
}

export interface EncryptedPayload {
  ciphertextBase64: string;
  ivBase64: string;
  algorithm: 'AES-256-GCM';
}

export interface CryptoAdapter {
  generateSymmetricKey(): Promise<CryptoKey>;
  exportKey(key: CryptoKey): Promise<string>;
  importKey(rawBase64: string): Promise<CryptoKey>;
  encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload, key: CryptoKey): Promise<string>;
  digestSha256(data: string): Promise<string>;
}

export class WebCryptoAdapter implements CryptoAdapter {
  private crypto: Crypto;

  constructor() {
    this.crypto = globalThis.crypto;
    if (!this.crypto?.subtle) {
      throw new Error('WebCrypto subtle API is unavailable in this runtime environment');
    }
  }

  async generateSymmetricKey(): Promise<CryptoKey> {
    return await this.crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async exportKey(key: CryptoKey): Promise<string> {
    const exported = await this.crypto.subtle.exportKey('raw', key);
    return Buffer.from(exported).toString('base64');
  }

  async importKey(rawBase64: string): Promise<CryptoKey> {
    const rawBuffer = Buffer.from(rawBase64, 'base64');
    return await this.crypto.subtle.importKey(
      'raw',
      rawBuffer,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedPayload> {
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await this.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encoded
    );

    return {
      ciphertextBase64: Buffer.from(ciphertext).toString('base64'),
      ivBase64: Buffer.from(iv).toString('base64'),
      algorithm: 'AES-256-GCM',
    };
  }

  async decrypt(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
    const iv = Buffer.from(payload.ivBase64, 'base64');
    const ciphertext = Buffer.from(payload.ciphertextBase64, 'base64');

    const decrypted = await this.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  async digestSha256(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const hashBuffer = await this.crypto.subtle.digest('SHA-256', encoded);
    return Buffer.from(hashBuffer).toString('hex');
  }
}

export class MultiDeviceKeyManager {
  private keysStore: Map<string, DeviceKeys[]>;

  constructor() {
    this.keysStore = new Map();
  }

  registerDevice(deviceId: string, publicKey: string): void {
    if (!this.keysStore.has(deviceId)) {
      this.keysStore.set(deviceId, []);
    }
    const deviceKeys: DeviceKeys = {
      deviceId,
      publicKey,
      privateKey: '',
      registeredAt: new Date(),
    };
    this.keysStore.get(deviceId)!.push(deviceKeys);
  }

  getKeys(deviceId: string): DeviceKeys | undefined {
    const devices = this.keysStore.get(deviceId);
    if (!devices || devices.length === 0) return undefined;
    return devices[devices.length - 1];
  }

  syncKeys(deviceIds: string[]): void {
    for (const deviceId of deviceIds) {
      const device = this.getKeys(deviceId);
      if (device) {
        // Sync logic - in a real implementation, this would
        // propagate keys to a sync service
      }
    }
  }

  revokeDevice(deviceId: string): void {
    this.keysStore.delete(deviceId);
  }
}
