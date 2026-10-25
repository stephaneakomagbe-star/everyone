'use strict';

const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    return buf.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}

function classify(buf) {
  const mime = sniff(buf);
  if (!mime || !EXT[mime]) return null;
  const video = mime.startsWith('video/');
  if (video && buf.length > 25 * 1024 * 1024) return { error: 'Vidéo trop lourde (25 Mo maximum).' };
  if (!video && buf.length > 8 * 1024 * 1024) return { error: 'Image trop lourde (8 Mo maximum).' };
  if (!video && buf.length < 100) return { error: 'Image trop petite.' };
  return { mime, ext: EXT[mime], video };
}

module.exports = { sniff, classify, EXT };
