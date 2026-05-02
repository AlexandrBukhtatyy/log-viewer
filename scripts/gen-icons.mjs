import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makePng(width, height, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(2, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)

  const rowSize = width * 3 + 1
  const raw = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0
    for (let x = 0; x < width; x++) {
      const off = y * rowSize + 1 + x * 3
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
    }
  }
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync('public', { recursive: true })
const color = [31, 41, 55]
writeFileSync('public/pwa-192x192.png', makePng(192, 192, color))
writeFileSync('public/pwa-512x512.png', makePng(512, 512, color))
writeFileSync('public/apple-touch-icon.png', makePng(180, 180, color))
console.log('Generated PWA icons in public/')
