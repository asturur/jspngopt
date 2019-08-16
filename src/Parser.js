"use strict";

var pako = require("pako");
var Image = require("./Image");

function Parser() {
  this.chunks = [];
}

Parser.prototype.check = function() {
  if (this.chunks.length < 2)
    throw Error("Less than two chunks");
  if (this.chunks[0].type !== "IHDR")
    throw Error("File doesn't start with IHDR chunk");
  if (this.chunks[this.chunks.length - 1].type !== "IEND")
    throw Error("File does not end with IEND chunk");
};

Parser.prototype.chunk = function(buf) {
  var type = buf.toString("utf8", 4, 8);
  this.chunks.push({type: type, data: buf});
  var handler = this["handle_" + type];
  if (handler) handler.call(this, buf);
};

Parser.prototype.handle_IHDR = function(buf) {
  if (buf.length !== 12 + 13)
    throw Error("IHDR chunk should have 13 data bytes");
  var hdr = this.hdr = {
    width: buf.readUInt32BE(8),
    height: buf.readUInt32BE(12),
    bitDepth: buf.readUInt8(16),
    colorType: buf.readUInt8(17),
    compressionMethod: buf.readUInt8(18),
    filterMethod: buf.readUInt8(19),
    interlaceMethod: buf.readUInt8(20),
  };
  if ([1, 2, 4, 8, 16].indexOf(hdr.bitDepth) === -1)
    throw Error("Unsupported bit depth: " + hdr.bitDepth);
  if ([0, 2, 3, 4, 6].indexOf(hdr.colorType) === -1)
    throw Error("Unsupported color type: " + hdr.colorType);
  if ([0, 3].indexOf(hdr.colorType) === -1 && hdr.bitDepth < 8)
    throw Error("Multi-sample sub-byte images are disallowed");
  if (hdr.colorType === 3 && hdr.bitDepth > 8)
    throw Error("Multi-byte palette images are disallowed");
  if (hdr.compressionMethod !== 0)
    throw Error("Unsupported compression method: " + hdr.compressionMethod);
  if (hdr.filterMethod !== 0)
    throw Error("Unsupported filter method: " + hdr.filterMethod);
  if (hdr.interlaceMethod !== 0)
    throw Error("Interlacing not supported yet.");
};

Parser.prototype.handle_IEND = function(buf) {
  if (buf.length !== 12)
    throw Error("IEND chunk should have 0 data bytes");
};

Parser.prototype.parse = function(buf) {
  this.chunks = [];
  this.idat = [];
  if (buf.length < 57)
    throw Error("Too short to be a PNG file");
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    throw Error("PNG signature missing");
  var pos = 8;
  while (pos < buf.length) {
    if (pos + 12 > buf.length)
      throw Error("Incomplete chunk at offset 0x" + pos.toString(16));
    var len = buf.readUInt32BE(pos);
    if (len >= 0x80000000)
      throw Error("Chunk too long");
    var end = pos + 12 + len;
    if (end > buf.length)
      throw Error("Incomplete chunk at offset 0x" + pos.toString(16));
    this.chunk(buf.slice(pos, end));
    pos = end;
  }
  this.check();
  if (this.idat.length === 0)
    throw Error("File does not contain any IDAT chunks");
  var idat = Buffer.concat(this.idat);
  idat = this.inflate(idat);
  var img = new Image(this.hdr, this.chunks, idat);
  this.chunks = this.idat = null; // free for easier garbage collection
  return img;
};

Parser.prototype.handle_IDAT = function(buf) {
  this.idat.push(buf.slice(8, buf.length - 4));
};

Parser.prototype.inflate = pako.inflate;

module.exports = Parser;
