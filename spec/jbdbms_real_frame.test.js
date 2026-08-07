"use strict";

// Self-contained regression test against a real, checksum-verified JBD
// basic-info (0x03) frame captured 2026-08-07 from one of Symphony's two
// house batteries (mark-brannan/dotfiles, scripts/data/
// ble-poll-mac-20260807T042526Z.log). Deliberately does not import
// JBDBMS.js/BTSensor.js -- those pull in BLE stack dependencies
// (@jellybrick/dbus-next, @naugehyde/node-ble) that aren't relevant to
// pure frame decoding and may not be installed in every environment this
// runs in. Instead this mirrors the exact field-offset formulas and
// checksum algorithm from sensor_classes/JBDBMS.js, so a future change to
// either one that isn't reflected here should be caught by eyeballing the
// diff, and a regression in the *values* those formulas produce is caught
// automatically.

const test = require("node:test");
const assert = require("node:assert/strict");

const REAL_FRAME = Buffer.from(
  "dd0300220527000043676d600007317900000000" +
  "0000663e0304010bb80000006d6043670000faa4" +
  "77",
  "hex"
);

// Mirrors JBDBMS.js's checkSum(): two's-complement 16-bit sum over
// status..last-data-byte, compared against the trailing 2-byte checksum.
function checkSum(buffer) {
  const length = buffer[3];
  const dataEnd = 4 + length;
  let sum = 0;
  for (let i = 2; i < dataEnd; i++) sum += buffer[i];
  const expected = (0x10000 - sum) & 0xffff;
  const actual = buffer.readUInt16BE(dataEnd);
  return expected === actual;
}

test("real captured frame: checksum validates", () => {
  assert.equal(REAL_FRAME.length, 41);
  assert.equal(REAL_FRAME[0], 0xdd, "start byte");
  assert.equal(REAL_FRAME[1], 0x03, "command echo (basic info)");
  assert.equal(REAL_FRAME[2], 0x00, "status OK");
  assert.equal(REAL_FRAME[REAL_FRAME.length - 1], 0x77, "stop byte");
  assert.ok(checkSum(REAL_FRAME), "checksum must validate");
});

test("real captured frame: decodes to physically plausible, internally consistent values", () => {
  // Offsets match sensor_classes/JBDBMS.js's initSchema() exactly.
  const voltage = REAL_FRAME.readUInt16BE(4) / 100;
  const current = REAL_FRAME.readInt16BE(6) / 100;
  const remainingAh = REAL_FRAME.readUInt16BE(8) / 100;
  const nominalAh = REAL_FRAME.readUInt16BE(10) / 100;
  const cycles = REAL_FRAME.readUInt16BE(12);
  const protectionWord = REAL_FRAME.readUInt16BE(20);
  const soc = REAL_FRAME.readUInt8(23);
  const fet = REAL_FRAME.readUInt8(24);
  const numCells = REAL_FRAME.readUInt8(25);
  const numTemps = REAL_FRAME.readUInt8(26);
  const temp0K = REAL_FRAME.readUInt16BE(27) / 10;

  assert.equal(voltage, 13.19);
  assert.equal(current, 0);
  assert.equal(remainingAh, 172.55);
  assert.equal(nominalAh, 280); // matches Eco-Worthy 280Ah spec exactly
  assert.equal(cycles, 7);
  assert.equal(protectionWord, 0);
  assert.equal(soc, 62);
  assert.equal(fet & 0x1, 1, "charge FET on");
  assert.equal((fet >> 1) & 0x1, 1, "discharge FET on");
  assert.equal(numCells, 4); // correct for 12V LFP (4S)
  assert.equal(numTemps, 1);
  assert.equal(temp0K, 300.0);
  assert.ok(Math.abs(temp0K - 273.15 - 26.85) < 0.001, "26.85 C, plausible");

  // Cross-check: SOC should roughly match remaining/nominal ratio.
  const impliedSoc = (remainingAh / nominalAh) * 100;
  assert.ok(Math.abs(impliedSoc - soc) < 1, "SOC consistent with capacity ratio");
});
