"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const CyclopsSmartload = require("../sensor_classes/CyclopsSmartload");

const RAW_ADVERTISEMENT = Buffer.from([
  0xc3, 0x04, 0x01, 0xa1, 0x6d, 0x00, 0x01,
  0xbb, 0x1c, 0xc2, 0x00, 0xa1, 0x6d,
]);

const TRANSMITTED_ADVERTISEMENT = Buffer.from([
  0xc3, 0x04, 0x01, 0xc1, 0xc4, 0x6c, 0x65,
  0xa4, 0x6d, 0xd3, 0x4a, 0xb7, 0x18,
]);

test("isSmartloadName: matches documented and observed BLE names", () => {
  assert.equal(CyclopsSmartload.isSmartloadName("Cyc12345"), true);
  assert.equal(CyclopsSmartload.isSmartloadName("Smart Load Two"), true);
  assert.equal(CyclopsSmartload.isSmartloadName("SmartLoad2"), true);
  assert.equal(CyclopsSmartload.isSmartloadName("Smart Load Three"), false);
});

test("decodeAdvertisement: decodes PDF manufacturer-data example", () => {
  const reading = CyclopsSmartload.decodeAdvertisement(TRANSMITTED_ADVERTISEMENT);

  assert.ok(reading);
  assert.equal(reading.manufacturerID, 0x04c3);
  assert.equal(reading.protocol, 0x01);
  assert.equal(reading.dataTag, 0xa16d);
  assert.equal(reading.status, 0x00);
  assert.equal(reading.units, 0x01);
  assert.ok(Math.abs(reading.tonnes - -0.00239193) < 0.00000001);
  assert.ok(Math.abs(reading.kg - -2.39193) < 0.00001);
});

test("decodeAdvertisement: accepts BlueZ payload without manufacturer id bytes", () => {
  const bluezPayload = TRANSMITTED_ADVERTISEMENT.subarray(2);
  const reading = CyclopsSmartload.decodeAdvertisement(bluezPayload);

  assert.ok(reading);
  assert.equal(reading.dataTag, 0xa16d);
  assert.ok(Math.abs(reading.tonnes - -0.00239193) < 0.00000001);
});

test("decodeAdvertisement: rejects payload when duplicated data tags differ", () => {
  const bad = Buffer.from(TRANSMITTED_ADVERTISEMENT);
  bad[12] ^= 0xff;

  assert.equal(CyclopsSmartload.decodeAdvertisement(bad), null);
});

test("decodeAdvertisement: XOR key matches the published raw data", () => {
  const normalized = CyclopsSmartload.normalizeAdvertisement(TRANSMITTED_ADVERTISEMENT);
  const decoded = Buffer.alloc(CyclopsSmartload.advertisementKey.length);
  for (let i = 0; i < decoded.length; i++)
    decoded[i] = normalized[i + 3] ^ CyclopsSmartload.advertisementKey[i];

  assert.deepEqual(decoded, RAW_ADVERTISEMENT.subarray(3));
});

test("decodeGATTLoad: decodes signed 100 g increments", () => {
  const sample = Buffer.from([0x12, 0x13, 0xff, 0xff]);
  const reading = CyclopsSmartload.decodeGATTLoad(sample);

  assert.ok(reading);
  assert.equal(reading.tonnes, -6.0654);
  assert.equal(reading.kg, -6065.4);
});

test("decodeGATTLoad: decodes positive characteristic example", () => {
  const sample = Buffer.from([0xbc, 0x4d, 0x00, 0x00]);
  const reading = CyclopsSmartload.decodeGATTLoad(sample);

  assert.ok(reading);
  assert.equal(reading.tonnes, 1.99);
  assert.equal(reading.kg, 1990);
});

test("decodeTemperature and decodeBatteryStrength: decode service values", () => {
  assert.ok(Math.abs(CyclopsSmartload.decodeTemperature(Buffer.from([0x66, 0x02])) - 292.3375) < 0.0001);
  assert.equal(CyclopsSmartload.decodeBatteryStrength(Buffer.from([0x32])), 0.5);
});

test("decodeStatus: expands documented status bits", () => {
  assert.deepEqual(CyclopsSmartload.decodeStatus(0x11), [
    "Channel A overflow",
    "Channel A hardware fault on bridge drive",
  ]);
});
