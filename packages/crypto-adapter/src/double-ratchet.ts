/**
 * Double Ratchet session layer (simplified, WebCrypto-backed).
 * Spec Reference: 12_SECURITY_PRIVACY_SPEC.md, 31_E2EE
 *
 * Symmetric chain model: both parties derive mirrored send/recv chains
 * from the ECDH shared secret root. Alice's send == Bob's recv and
 * vice versa. Each encrypt/decrypt steps the chain forward via HKDF.
 */

export interface RatchetSessionState {
  rootKey: string; // base64
  sendChainKey: string; // base64
  recvChainKey: string; // base64
  sendCount: number;
  recvCount: number;
}

export interface RatchetMessage {
  ciphertextBase64: string;
  ivBase64: string;
  header: {
    messageNumber: number;
  };
  algorithm: 'AES-256-GCM-DR';
}

function toBuf(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function b64(u8: Uint8Array): string {
  return Buffer.from(u8).toString('base64');
}

function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

async function hkdfDeriveBytes(
  crypto: Crypto,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', toBuf(ikm), 'HKDF', false, ['deriveBits']);
  const infoBytes = new TextEncoder().encode(info);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toBuf(salt), info: toBuf(infoBytes) },
    baseKey,
    length * 8
  );
  return new Uint8Array(bits);
}

async function importAesKey(crypto: Crypto, raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBuf(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function stepChain(
  crypto: Crypto,
  chainKeyB64: string
): Promise<{ messageKey: Uint8Array; nextChain: Uint8Array }> {
  const chainKey = unb64(chainKeyB64);
  const messageKey = await hkdfDeriveBytes(crypto, chainKey, new Uint8Array(0), 'mk', 32);
  const nextChain = await hkdfDeriveBytes(crypto, chainKey, new Uint8Array(0), 'ck', 32);
  return { messageKey, nextChain };
}

export class DoubleRatchetSession {
  private crypto: Crypto;
  private state: RatchetSessionState;

  private constructor(state: RatchetSessionState) {
    this.crypto = globalThis.crypto;
    if (!this.crypto?.subtle) throw new Error('WebCrypto unavailable');
    this.state = state;
  }

  /**
   * Initiator (Alice): send=AB chain, recv=BA chain.
   */
  static async initiate(sharedSecret: Uint8Array): Promise<DoubleRatchetSession> {
    const crypto = globalThis.crypto;
    const root = await hkdfDeriveBytes(crypto, sharedSecret, new Uint8Array(32), 'orbit:v1:dr:root', 32);
    const sendChain = await hkdfDeriveBytes(crypto, root, new Uint8Array(0), 'orbit:v1:dr:ab', 32);
    const recvChain = await hkdfDeriveBytes(crypto, root, new Uint8Array(0), 'orbit:v1:dr:ba', 32);
    return new DoubleRatchetSession({
      rootKey: b64(root),
      sendChainKey: b64(sendChain),
      recvChainKey: b64(recvChain),
      sendCount: 0,
      recvCount: 0,
    });
  }

  /**
   * Responder (Bob): send=BA chain, recv=AB chain (mirrored).
   */
  static async respond(sharedSecret: Uint8Array): Promise<DoubleRatchetSession> {
    const crypto = globalThis.crypto;
    const root = await hkdfDeriveBytes(crypto, sharedSecret, new Uint8Array(32), 'orbit:v1:dr:root', 32);
    const sendChain = await hkdfDeriveBytes(crypto, root, new Uint8Array(0), 'orbit:v1:dr:ba', 32);
    const recvChain = await hkdfDeriveBytes(crypto, root, new Uint8Array(0), 'orbit:v1:dr:ab', 32);
    return new DoubleRatchetSession({
      rootKey: b64(root),
      sendChainKey: b64(sendChain),
      recvChainKey: b64(recvChain),
      sendCount: 0,
      recvCount: 0,
    });
  }

  getState(): RatchetSessionState {
    return { ...this.state };
  }

  static fromState(state: RatchetSessionState): DoubleRatchetSession {
    return new DoubleRatchetSession({ ...state });
  }

  async encrypt(plaintext: string): Promise<RatchetMessage> {
    const { messageKey, nextChain } = await stepChain(this.crypto, this.state.sendChainKey);
    this.state.sendChainKey = b64(nextChain);

    const key = await importAesKey(this.crypto, messageKey);
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await this.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuf(iv) },
      key,
      toBuf(encoded)
    );

    const header = { messageNumber: this.state.sendCount };
    this.state.sendCount += 1;

    return {
      ciphertextBase64: b64(new Uint8Array(ciphertext)),
      ivBase64: b64(iv),
      header,
      algorithm: 'AES-256-GCM-DR',
    };
  }

  async decrypt(msg: RatchetMessage): Promise<string> {
    const { messageKey, nextChain } = await stepChain(this.crypto, this.state.recvChainKey);
    this.state.recvChainKey = b64(nextChain);

    const key = await importAesKey(this.crypto, messageKey);
    const iv = unb64(msg.ivBase64);
    const ciphertext = unb64(msg.ciphertextBase64);
    const decrypted = await this.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuf(iv) },
      key,
      toBuf(ciphertext)
    );
    this.state.recvCount += 1;
    return new TextDecoder().decode(decrypted);
  }
}

/** ECDH P-256 key agreement helpers. */
export async function generateEphemeralKeyPair(): Promise<{ publicKeyRaw: Uint8Array; privateKey: CryptoKey }> {
  const crypto = globalThis.crypto;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKeyRaw: rawPub, privateKey: pair.privateKey };
}

export async function deriveSharedSecret(privateKey: CryptoKey, remotePublicRaw: Uint8Array): Promise<Uint8Array> {
  const crypto = globalThis.crypto;
  const remotePub = await crypto.subtle.importKey(
    'raw',
    toBuf(remotePublicRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: remotePub }, privateKey, 256);
  return new Uint8Array(secret);
}
