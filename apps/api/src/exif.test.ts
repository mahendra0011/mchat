import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripJpegExif, looksLikeJpeg } from './exif.js';

function jpegWithExif(): { original: Buffer; expectedWithoutExif: Buffer } {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from([0x01, 0x02, 0x03, 0x04])]);
  const exifSeg = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(exifPayload.length + 2) >> 8, (exifPayload.length + 2) & 0xff]),
    exifPayload,
  ]);
  const comPayload = Buffer.from('hello');
  const comSeg = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([(comPayload.length + 2) >> 8, (comPayload.length + 2) & 0xff]),
    comPayload,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);
  const imageData = Buffer.from([0x11, 0x22, 0x33]);
  const eoi = Buffer.from([0xff, 0xd9]);

  const original = Buffer.concat([soi, exifSeg, comSeg, sos, imageData, eoi]);
  const expectedWithoutExif = Buffer.concat([soi, comSeg, sos, imageData, eoi]);
  return { original, expectedWithoutExif };
}

test('stripJpegExif removes the APP1 EXIF segment and preserves other segments', () => {
  const { original, expectedWithoutExif } = jpegWithExif();
  const stripped = stripJpegExif(original);
  assert.ok(stripped.length < original.length, 'stripped output must be smaller');
  assert.deepEqual(stripped, expectedWithoutExif);
});

test('stripJpegExif leaves a JPEG without EXIF unchanged', () => {
  const soi = Buffer.from([0xff, 0xd8]);
  const comPayload = Buffer.from('keep me');
  const comSeg = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([(comPayload.length + 2) >> 8, (comPayload.length + 2) & 0xff]),
    comPayload,
  ]);
  const rest = Buffer.from([0xff, 0xda, 0x00, 0x02, 0xaa, 0xff, 0xd9]);
  const original = Buffer.concat([soi, comSeg, rest]);
  assert.deepEqual(stripJpegExif(original), original);
});

test('stripJpegExif returns non-JPEG input unchanged', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.deepEqual(stripJpegExif(png), png);
  assert.equal(looksLikeJpeg(png), false);
});

test('looksLikeJpeg detects SOI', () => {
  assert.equal(looksLikeJpeg(Buffer.from([0xff, 0xd8, 0xff])), true);
  assert.equal(looksLikeJpeg(Buffer.from([0x47, 0x49, 0x46])), false);
});
