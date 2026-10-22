/**
 * Canvas-based QR Code generator (no external dependencies).
 * Implements a minimal QR code encoder for alphanumeric data.
 * Based on QR Code specification (ISO/IEC 18004) - Version 1, Level L.
 */

const ALPHANUMERIC_TABLE: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15, 'G': 16, 'H': 17, 'I': 18, 'J': 19,
  'K': 20, 'L': 21, 'M': 22, 'N': 23, 'O': 24, 'P': 25, 'Q': 26, 'R': 27, 'S': 28, 'T': 29,
  'U': 30, 'V': 31, 'W': 32, 'X': 33, 'Y': 34, 'Z': 35,
  ' ': 36, '$': 37, '%': 38, '*': 39, '+': 40, '-': 41, '.': 42, '/': 43, ':': 44,
};

const VERSION_1_L = {
  version: 1,
  errorCorrectionLevel: 'L',
  totalCodewords: 26,
  dataCodewords: 19,
  ecCodewords: 7,
  blocks: 1,
  size: 21,
};

const GF256_GEN_POLY = 0x11D;

function gf256Multiply(a: number, b: number): number {
  let result = 0;
  while (b > 0) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 0x100) a ^= GF256_GEN_POLY;
    b >>= 1;
  }
  return result;
}

function gf256Divide(dividend: number[], divisor: number[]): number[] {
  const result = [...dividend];
  const divisorDegree = divisor.length - 1;

  for (let i = 0; i <= result.length - divisor.length; i++) {
    const coeff = result[i];
    if (coeff === 0) continue;
    for (let j = 0; j < divisor.length; j++) {
      result[i + j] ^= gf256Multiply(divisor[j], coeff);
    }
  }
  return result.slice(-divisorDegree);
}

function generateECCodewords(dataCodewords: number[], ecCount: number): number[] {
  let generator = [1];
  for (let i = 0; i < ecCount; i++) {
    const newGen = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      newGen[j] ^= gf256Multiply(generator[j], 1);
      newGen[j + 1] ^= gf256Multiply(generator[j], (1 << i) % 256);
    }
    generator = newGen;
  }

  const padded = [...dataCodewords, ...new Array(ecCount).fill(0)];
  return gf256Divide(padded, generator);
}

function addFinderPatterns(matrix: number[][], size: number): void {
  const pattern = [
    [1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1],
  ];

  const positions = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [r, c] of positions) {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        matrix[r + i][c + j] = pattern[i][j];
      }
    }
  }
}

function addTimingPatterns(matrix: number[][], size: number): void {
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0 ? 1 : 0;
    matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }
}

function addDarkModule(matrix: number[][], size: number): void {
  matrix[size - 8][8] = 1;
}

function addFormatInfo(matrix: number[][], size: number, ecLevel: number, _mask: number): void {
  const formatBits = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,1,0,0,0,0,0,1,0,0,1,0,1,0],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,1,0,0,0,0,0,1,0,0,1,0,1,0],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,1,0,0,0,0,0,1,0,0,1,0,1,0],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,1,0,0,0,0,0,1,0,0,1,0,1,0],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ];

  for (let i = 0; i < 15; i++) {
    const bit = formatBits[ecLevel][i];
    if (i < 6) matrix[8][i] = bit;
    else if (i < 8) matrix[8][i + 1] = bit;
    else matrix[8][size - 15 + i] = bit;

    if (i < 8) matrix[size - 15 + i][8] = bit;
    else if (i < 9) matrix[size - 8][8] = bit;
    else matrix[14 - i][8] = bit;
  }
}

function getMaskFunction(mask: number): (row: number, col: number) => boolean {
  switch (mask) {
    case 0: return (_r, _c) => (mask + 0) % 2 === 0 || ((_r + _c) % 2 === 0);
    case 1: return (_r, _c) => _r % 2 === 0;
    case 2: return (_r, _c) => _c % 3 === 0;
    case 3: return (_r, _c) => (_r + _c) % 3 === 0;
    case 4: return (_r, _c) => (Math.floor(_r / 2) + Math.floor(_c / 3)) % 2 === 0;
    case 5: return (_r, _c) => (_r * _c) % 2 + (_r * _c) % 3 === 0;
    case 6: return (_r, _c) => ((_r * _c) % 2 + (_r * _c) % 3) % 2 === 0;
    case 7: return (_r, _c) => ((_r * _c) % 3 + (_r + _c) % 2) % 2 === 0;
    default: return () => false;
  }
}

function applyMask(matrix: number[][], size: number, mask: number): void {
  const maskFn = getMaskFunction(mask);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === -1) continue;
      if (maskFn(r, c)) matrix[r][c] ^= 1;
    }
  }
}

function isFunctionModule(row: number, col: number, size: number): boolean {
  if (row < 9 && col < 9) return true;
  if (row < 9 && col >= size - 8) return true;
  if (row >= size - 8 && col < 9) return true;
  if (row === 6 || col === 6) return true;
  if (row === size - 8 && col === 8) return true;
  return false;
}

function placeData(matrix: number[][], size: number, codewords: number[]): void {
  let bitIndex = 0;
  let dir = -1;
  let col = size - 1;

  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = dir === -1 ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const currentCol = col - c;
        if (isFunctionModule(r, currentCol, size)) continue;
        if (bitIndex >= codewords.length * 8) return;
        const byte = codewords[Math.floor(bitIndex / 8)];
        const bit = (byte >> (7 - (bitIndex % 8))) & 1;
        matrix[r][currentCol] = bit;
        bitIndex++;
      }
    }
    dir *= -1;
    col -= 2;
  }
}

function calculatePenalty(matrix: number[][], size: number): number {
  let penalty = 0;

  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) run++;
      else {
        if (run >= 5) penalty += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) penalty += 3 + (run - 5);
  }

  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) run++;
      else {
        if (run >= 5) penalty += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) penalty += 3 + (run - 5);
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = matrix[r][c];
      if (
        matrix[r][c + 1] === color &&
        matrix[r + 1][c] === color &&
        matrix[r + 1][c + 1] === color
      ) {
        penalty += 3;
      }
    }
  }

  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) darkCount++;
    }
  }
  const darkRatio = darkCount / (size * size);
  const deviation = Math.abs(darkRatio * 100 - 50) / 5;
  penalty += Math.floor(deviation) * 10;

  return penalty;
}

function encodeAlphanumeric(text: string): number[] {
  const bits: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (i + 1 < text.length) {
      const v1 = ALPHANUMERIC_TABLE[text[i]] ?? 0;
      const v2 = ALPHANUMERIC_TABLE[text[i + 1]] ?? 0;
      const val = v1 * 45 + v2;
      bits.push(...[...val.toString(2).padStart(11, '0')].map(Number));
      i += 2;
    } else {
      const v = ALPHANUMERIC_TABLE[text[i]] ?? 0;
      bits.push(...[...v.toString(2).padStart(6, '0')].map(Number));
      i += 1;
    }
  }
  return bits;
}

function bitsToBytes(bits: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8 && i + j < bits.length; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    bytes.push(byte);
  }
  return bytes;
}

function buildQRCode(text: string, mask = 0): number[][] {
  const size = VERSION_1_L.size;
  const matrix: number[][] = Array(size).fill(0).map(() => Array(size).fill(-1));

  addFinderPatterns(matrix, size);
  addTimingPatterns(matrix, size);
  addDarkModule(matrix, size);

  const modeIndicator = [0, 0, 1, 0];
  const charCount = text.length.toString(2).padStart(9, '0').split('').map(Number);
  const dataBits = encodeAlphanumeric(text.toUpperCase());

  const allBits = [...modeIndicator, ...charCount, ...dataBits];
  while (allBits.length % 8 !== 0) allBits.push(0);

  const terminatorBits = Math.min(4, VERSION_1_L.dataCodewords * 8 - allBits.length);
  for (let i = 0; i < terminatorBits; i++) allBits.push(0);

  while (allBits.length < VERSION_1_L.dataCodewords * 8) {
    allBits.push(...[1,1,1,0,1,1,0,0]);
    if (allBits.length >= VERSION_1_L.dataCodewords * 8) break;
    allBits.push(...[0,0,0,1,0,0,0,1]);
  }

  const dataCodewords = bitsToBytes(allBits.slice(0, VERSION_1_L.dataCodewords * 8));
  const ecCodewords = generateECCodewords(dataCodewords, VERSION_1_L.ecCodewords);
  const allCodewords = [...dataCodewords, ...ecCodewords];

  placeData(matrix, size, allCodewords);
  applyMask(matrix, size, mask);
  addFormatInfo(matrix, size, 1, mask);

  return matrix;
}

function matrixToSVG(matrix: number[][], moduleSize = 4, margin = 4, dark = '#000000', light = '#ffffff'): string {
  const size = matrix.length;
  const totalSize = (size + margin * 2) * moduleSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges">`;
  svg += `<rect width="${totalSize}" height="${totalSize}" fill="${light}"/>`;
  svg += `<g fill="${dark}">`;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        svg += `<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`;
      }
    }
  }
  svg += '</g></svg>';
  return svg;
}

export function generateQRCodeSVG(text: string, options?: {
  moduleSize?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}): string {
  const dark = options?.darkColor ?? '#000000';
  const light = options?.lightColor ?? '#ffffff';
  let bestMatrix: number[][] = [];
  let bestPenalty = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const matrix = buildQRCode(text, mask);
    const penalty = calculatePenalty(matrix, matrix.length);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = matrix;
    }
  }

  return matrixToSVG(bestMatrix, options?.moduleSize ?? 4, options?.margin ?? 4, dark, light);
}

export function generateQRCodeDataURL(text: string, options?: {
  moduleSize?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}): string {
  const svg = generateQRCodeSVG(text, options);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function generateQRCodeCanvas(text: string, canvas: HTMLCanvasElement, options?: {
  moduleSize?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}): void {
  const dark = options?.darkColor ?? '#000000';
  const light = options?.lightColor ?? '#ffffff';
  const moduleSize = options?.moduleSize ?? 4;
  const margin = options?.margin ?? 4;

  let bestMatrix: number[][] = [];
  let bestPenalty = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const matrix = buildQRCode(text, mask);
    const penalty = calculatePenalty(matrix, matrix.length);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = matrix;
    }
  }

  const size = bestMatrix.length;
  const totalSize = (size + margin * 2) * moduleSize;
  canvas.width = totalSize;
  canvas.height = totalSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, totalSize, totalSize);

  ctx.fillStyle = dark;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (bestMatrix[r][c] === 1) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        ctx.fillRect(x, y, moduleSize, moduleSize);
      }
    }
  }
}

export function generateQRCodeBlob(text: string, options?: {
  moduleSize?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}): Promise<Blob> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    generateQRCodeCanvas(text, canvas, options);
    canvas.toBlob((blob) => {
      resolve(blob ?? new Blob());
    }, 'image/png');
  });
}