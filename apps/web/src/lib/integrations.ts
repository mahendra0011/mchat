const subtle = window.crypto.subtle;
const getRandomValues = window.crypto.getRandomValues.bind(window.crypto);

const ALGORITHM_AES = 'AES-GCM';
const ALGORITHM_RSA = 'RSA-OAEP';
const HASH_ALGORITHM = 'SHA-256';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const ITERATIONS = 100000;

interface EncryptedPayload {
  version: string;
  algorithm: string;
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  const binary = Uint8Array.from(atob(spkiBase64), (c) => c.charCodeAt(0));
  return subtle.importKey('spki', binary, { name: ALGORITHM_RSA, hash: HASH_ALGORITHM }, true, ['encrypt']);
}

async function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  const binary = Uint8Array.from(atob(pkcs8Base64), (c) => c.charCodeAt(0));
  return subtle.importKey('pkcs8', binary, { name: ALGORITHM_RSA, hash: HASH_ALGORITHM }, true, ['decrypt']);
}

async function generateEphemeralKeyPair(): Promise<CryptoKeyPair> {
  return subtle.generateKey(
    { name: ALGORITHM_RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: HASH_ALGORITHM },
    true,
    ['encrypt', 'decrypt']
  );
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(spki)));
}

async function deriveAesKey(sharedSecret: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await subtle.importKey('raw', sharedSecret, { name: 'PBKDF2' }, false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations: ITERATIONS, hash: HASH_ALGORITHM },
    baseKey,
    { name: ALGORITHM_AES, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export class IntegrationE2EEClient {
  static async encryptForIntegration(
    plaintext: string,
    integrationPublicKeySpki: string
  ): Promise<string> {
    const recipientPublicKey = await importPublicKey(integrationPublicKeySpki);
    const ephemeralKeyPair = await generateEphemeralKeyPair();

    const sharedSecret = await subtle.deriveBits(
      { name: ALGORITHM_RSA, public: recipientPublicKey },
      ephemeralKeyPair.privateKey,
      256
    );

    const salt = getRandomValues(new Uint8Array(SALT_LENGTH));
    const aesKey = await deriveAesKey(sharedSecret, salt);
    const iv = getRandomValues(new Uint8Array(IV_LENGTH));

    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await subtle.encrypt({ name: ALGORITHM_AES, iv }, aesKey, encoded);

    const ciphertextArray = new Uint8Array(ciphertext);
    const tagLength = 128 / 8;
    const tag = ciphertextArray.slice(-tagLength);
    const actualCiphertext = ciphertextArray.slice(0, -tagLength);

    const ephemeralPublicKey = await exportPublicKey(ephemeralKeyPair.publicKey);

    const payload: EncryptedPayload = {
      version: '1',
      algorithm: `${ALGORITHM_RSA}+${ALGORITHM_AES}+PBKDF2`,
      ephemeralPublicKey,
      salt: btoa(String.fromCharCode(...salt)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...actualCiphertext)),
      tag: btoa(String.fromCharCode(...tag)),
    };

    return btoa(JSON.stringify(payload));
  }

  static async decryptFromIntegration(
    encryptedBase64: string,
    privateKeyPkcs8: string
  ): Promise<string> {
    const json = JSON.parse(atob(encryptedBase64)) as EncryptedPayload;

    if (json.version !== '1') {
      throw new Error(`Unsupported encryption version: ${json.version}`);
    }

    const privateKey = await importPrivateKey(privateKeyPkcs8);
    const ephemeralPublicKey = await importPublicKey(json.ephemeralPublicKey);

    const sharedSecret = await subtle.deriveBits(
      { name: ALGORITHM_RSA, public: ephemeralPublicKey },
      privateKey,
      256
    );

    const salt = Uint8Array.from(atob(json.salt), (c) => c.charCodeAt(0));
    const aesKey = await deriveAesKey(sharedSecret, salt);
    const iv = Uint8Array.from(atob(json.iv), (c) => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(json.ciphertext), (c) => c.charCodeAt(0));
    const tag = Uint8Array.from(atob(json.tag), (c) => c.charCodeAt(0));

    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);

    const decrypted = await subtle.decrypt({ name: ALGORITHM_AES, iv }, aesKey, combined);
    return new TextDecoder().decode(decrypted);
  }

  static isE2EEConversation(conversation: { isE2EE?: boolean }): boolean {
    return conversation.isE2EE === true;
  }

  static getE2EEBadgeLabel(conversation: { isE2EE?: boolean }): string {
    if (!this.isE2EEConversation(conversation)) {
      return 'Standard In-Transit Encryption (TLS)';
    }
    return 'End-to-End Encrypted — this integration cannot access private conversations';
  }
}