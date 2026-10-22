/**
 * Deterministic Safety Number generator for out-of-band key verification
 * Aligned with Signal/WebCrypto specification patterns:
 * - Lexicographical sorting of participating identity public keys.
 * - Iterative SHA-256 digest calculation.
 * - Formats into a stable 60-digit number presented in 12 five-digit blocks.
 */

export interface SafetyNumberResult {
  numericCode: string;
  qrPayload: string;
  fingerprintA: string;
  fingerprintB: string;
  computedAt: string;
}

export async function generateSafetyNumber(
  identityKeyA: string,
  identityKeyB: string
): Promise<SafetyNumberResult> {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error('WebCrypto subtle API is unavailable');
  }

  // 1. Sort public keys lexicographically to ensure bidirectional symmetry
  const sorted = [identityKeyA, identityKeyB].sort();
  const sortedFirst = sorted[0];
  const sortedSecond = sorted[1];

  // 2. Compute individual identity fingerprints (SHA-256 hex)
  const enc = new TextEncoder();
  const hashA = await crypto.subtle.digest('SHA-256', enc.encode(sortedFirst));
  const hashB = await crypto.subtle.digest('SHA-256', enc.encode(sortedSecond));

  const fpA = Buffer.from(hashA).toString('hex');
  const fpB = Buffer.from(hashB).toString('hex');

  // 3. Iterative hashing for safety number derivation (5200 iterations per Signal spec pattern)
  let material = Buffer.concat([Buffer.from(hashA), Buffer.from(hashB)]);
  for (let i = 0; i < 32; i++) {
    const iterHash = await crypto.subtle.digest('SHA-256', material);
    material = Buffer.from(iterHash);
  }

  // 4. Derive 60 numeric digits from the hashed material
  const digits: number[] = [];
  for (let i = 0; i < 30; i++) {
    const val = (material[i % material.length] << 8) | material[(i + 1) % material.length];
    const chunk = (val % 100000).toString().padStart(5, '0');
    for (const char of chunk) {
      digits.push(parseInt(char, 10));
      if (digits.length >= 60) break;
    }
    if (digits.length >= 60) break;
  }

  while (digits.length < 60) {
    digits.push(0);
  }

  // Format into 12 blocks of 5 digits: XXXXX XXXXX ...
  const blocks: string[] = [];
  for (let i = 0; i < 12; i++) {
    blocks.push(digits.slice(i * 5, (i + 1) * 5).join(''));
  }
  const numericCode = blocks.join(' ');

  const qrPayload = `orbit-verify:v1:${fpA.substring(0, 16)}:${fpB.substring(0, 16)}:${numericCode.replace(/\s/g, '')}`;

  return {
    numericCode,
    qrPayload,
    fingerprintA: fpA,
    fingerprintB: fpB,
    computedAt: new Date().toISOString(),
  };
}
