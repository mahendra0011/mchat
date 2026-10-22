/**
 * Minimal JPEG EXIF stripping (Spec 14 — media safety / privacy):
 * Removes the APP1 "Exif" segment from a JPEG byte stream without decoding
 * the image, so location/metadata embedded by cameras is never stored or served.
 *
 * JPEG layout: SOI (FFD8) then a sequence of segments. Each segment is
 *   FF <marker> <len_hi> <len_lo> <payload...>
 * where <len> (big-endian, includes itself but not the FF<marker>) spans the
 * payload. The image data begins at SOS (FFDA); EXIF always precedes it.
 */

const SOI = 0xd8;
const APP1 = 0xe1;
const SOS = 0xda;
const EOI = 0xd9;
const EXIF_MAGIC = Buffer.from('Exif\0\0', 'binary');

/** Returns the JPEG with any APP1 EXIF segment removed. Non-JPEG input is returned unchanged. */
export function stripJpegExif(input: Buffer): Buffer {
  // Must start with SOI.
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) {
    return input;
  }

  const out: number[] = [0xff, SOI];
  let i = 2;

  while (i + 1 < input.length) {
    if (input[i] !== 0xff) {
      // Malformed marker boundary; keep the remainder verbatim.
      return Buffer.concat([Buffer.from(out), input.subarray(i)]);
    }
    const marker = input[i + 1];

    // Standalone markers (no length field): copy and continue.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }

    // SOS or EOI: image data / end — nothing before it will be EXIF now.
    if (marker === SOS || marker === EOI) {
      return Buffer.concat([Buffer.from(out), input.subarray(i)]);
    }

    if (i + 3 >= input.length) {
      return Buffer.concat([Buffer.from(out), input.subarray(i)]);
    }
    const segmentLen = input.readUInt16BE(i + 2);
    const totalFromMarker = 2 + segmentLen; // FF<marker> + length field + payload
    if (segmentLen < 2 || i + totalFromMarker > input.length) {
      // Corrupt length; bail out and preserve the rest.
      return Buffer.concat([Buffer.from(out), input.subarray(i)]);
    }

    const payloadStart = i + 4;
    const isExifApp1 =
      marker === APP1 &&
      payloadStart + EXIF_MAGIC.length <= input.length &&
      input.subarray(payloadStart, payloadStart + EXIF_MAGIC.length).equals(EXIF_MAGIC);

    if (!isExifApp1) {
      for (let b = i; b < i + totalFromMarker; b++) out.push(input[b]);
    }
    // else: skip (drop) this EXIF segment.

    i += totalFromMarker;
  }

  if (i < input.length) {
    for (let b = i; b < input.length; b++) out.push(input[b]);
  }
  return Buffer.from(out);
}

export function looksLikeJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === SOI;
}
