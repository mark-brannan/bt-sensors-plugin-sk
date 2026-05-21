/**
 * Tests for GATT contact tracking.
 * Run with: node --test spec/contact_tracking.test.js
 *
 * A GATT-polled sensor (e.g. a BMS) does not receive BlueZ PropertiesChanged
 * signals while connected, so its only contact heartbeat is the value-emit
 * path. emit(tag, value) must stamp _lastContact for GATT sensors, otherwise
 * _lastContact freezes at connect time and the health check raises a
 * "No contact" warning that never clears even while data is flowing.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const BTSensor = require("../BTSensor");

test("emit() stamps _lastContact for a GATT sensor", () => {
  const sensor = new BTSensor(null, { useGATT: true });

  assert.equal(sensor._lastContact, undefined);

  const before = Date.now();
  sensor.emit("voltage", 12.5);

  assert.equal(typeof sensor._lastContact, "number");
  assert.ok(sensor._lastContact >= before);
});

test("emit() caches the value for getCurrentValue()", () => {
  const sensor = new BTSensor(null, { useGATT: true });

  sensor.emit("voltage", 12.5);

  assert.equal(sensor.getCurrentValue("voltage"), 12.5);
});

test("emit() does not stamp _lastContact for a non-GATT sensor", () => {
  const sensor = new BTSensor(null, { useGATT: false });

  sensor.emit("voltage", 12.5);

  // Advertisement sensors are stamped by _propertiesChanged, not emit().
  assert.equal(sensor._lastContact, undefined);
});
