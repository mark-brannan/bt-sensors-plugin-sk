"use strict";

// Regression test for sensor_classes/JBDBMS.js, driven through the real class
// rather than a copy of its formulas -- the offsets, the registered tags and
// the checksum under test are the ones the plugin actually runs, so changing
// any of them fails here.
//
// The frame is a real JBD basic-info (0x03) response, captured over BlueZ from
// Symphony's house battery at MAC A5:C2:37:40:01:46 on 2026-08-13 and verified
// against the BMS's own checksum. Attribution matters: both of her packs
// advertise the identical name "DP04S007L4S200A", so a capture taken by name
// cannot be tied to a physical battery. BlueZ exposes the MAC, which is how
// this one is known to be that pack and not its neighbour.
// Log: mark-brannan/dotfiles scripts/data/ble-poll-A5C237400146-20260813T224439Z.log

const test = require("node:test");
const assert = require("node:assert/strict");

const JBDBMS = require("../sensor_classes/JBDBMS.js");
const { checkSum } = JBDBMS;

const REAL_FRAME = Buffer.from(
  "dd0300220527000043286d600007317900000000" +
    "0000663d0304010ba00000006d6043280000fb3b" +
    "77",
  "hex"
);

// Enough of a SignalK app to catch what the sensor emits.
function appStub() {
  const deltas = [];
  return {
    deltas,
    debug() {},
    setPluginError() {},
    handleMessage(id, delta) {
      deltas.push(delta);
    },
  };
}

// Builds a configured sensor without going near the BLE stack: supplying
// numberOfCells/numberOfTemps is what lets initSchema() skip its GATT probe.
async function buildSensor({ temps = 1, cells = 4, app } = {}) {
  const sensor = new JBDBMS(
    {},
    {
      numberOfCells: cells,
      numberOfTemps: temps,
      currentProperties: {
        Name: "DP04S007L4S200A",
        Address: "A5:C2:37:40:01:46",
      },
      batteryID: "house1",
    }
  );
  if (app) sensor._app = app;
  await sensor.initSchema();
  return sensor;
}

const read = (sensor, tag) => sensor.getPath(tag).read(REAL_FRAME);

test("captured frame passes the BMS's own checksum", () => {
  assert.equal(REAL_FRAME.length, 41);
  assert.equal(REAL_FRAME[0], 0xdd, "start byte");
  assert.equal(REAL_FRAME[1], 0x03, "command echo (basic info)");
  assert.equal(REAL_FRAME[2], 0x00, "status OK");
  assert.equal(REAL_FRAME[REAL_FRAME.length - 1], 0x77, "stop byte");
  assert.ok(checkSum(REAL_FRAME), "checksum must validate");
});

test("a corrupted frame fails the checksum", () => {
  const corrupt = Buffer.from(REAL_FRAME);
  corrupt[5] ^= 0xff;
  assert.ok(!checkSum(corrupt), "flipped payload byte must be rejected");
});

test("decodes the captured frame to the pack's real state", async () => {
  const sensor = await buildSensor();

  assert.equal(read(sensor, "voltage"), 13.19);
  assert.equal(read(sensor, "current"), 0);
  assert.equal(read(sensor, "cycles"), 7);
  assert.equal(read(sensor, "SOC"), 0.61, "SignalK wants a 0..1 ratio");
  assert.equal(read(sensor, "protectionStatus").packOvervolt, false);
  assert.equal(read(sensor, "FET"), true);
  assert.equal(read(sensor, "FETCharging"), true);
  assert.equal(read(sensor, "FETDischarging"), true);
  assert.equal(read(sensor, "temp0"), 297.6, "K, i.e. 24.45 C");

  // Capacities are reported as energy, so they carry the pack voltage.
  const nominalAh = 280; // matches the Eco-Worthy 280Ah spec exactly
  assert.ok(
    Math.abs(read(sensor, "capacity") - nominalAh * 13.19 * 3600) < 1
  );
  assert.ok(
    Math.abs(read(sensor, "remainingCapacity") - 171.92 * 13.19 * 3600) < 1
  );

  // At rest, not discharging, so there is no meaningful time-to-go.
  assert.equal(read(sensor, "timeRemaining"), null);
});

// getAndEmitBatteryInfo() emits per-sensor `temp0..tempN-1`, and emitData()
// silently no-ops on a tag that was never registered. Registering a single
// "temperature" metadatum therefore dropped every temperature reading without
// raising anything.
test("registers a metadatum for each temperature sensor the frame declares", async () => {
  const sensor = await buildSensor({ temps: 1 });

  assert.ok(sensor.getPath("temp0"), "temp0 must be registered");
  assert.equal(
    sensor.getPath("temperature"),
    undefined,
    "the old tag emitted by nothing must be gone"
  );
});

test("registers every sensor on a multi-probe pack, each at its own offset", async () => {
  const sensor = await buildSensor({ temps: 2 });

  assert.ok(sensor.getPath("temp0"));
  assert.ok(sensor.getPath("temp1"));

  // Second probe reads two bytes further into the frame.
  const framed = Buffer.from(REAL_FRAME);
  framed.writeUInt8(2, 26); // frame declares two sensors
  framed.writeUInt16BE(3000, 27);
  framed.writeUInt16BE(2900, 29);
  assert.equal(sensor.getPath("temp0").read(framed), 300);
  assert.equal(sensor.getPath("temp1").read(framed), 290);
});

// initSchema falls back to two sensors when its startup GATT probe fails,
// which happens on this vessel. Without a guard the extra sensor reads the
// zeroed bytes past the real one and publishes 0 K -- about -273 C -- which
// looks like a genuine reading to anything consuming the path.
test("ignores temperature sensors the frame does not declare", async () => {
  const sensor = await buildSensor({ temps: 2 });

  assert.equal(REAL_FRAME.readUInt8(26), 1, "this pack declares one sensor");
  assert.equal(sensor.getPath("temp0").read(REAL_FRAME), 297.6);
  assert.equal(
    sensor.getPath("temp1").read(REAL_FRAME),
    null,
    "must not publish the zeroed tail as 0 K"
  );
});

test("survives a frame truncated mid-temperature", async () => {
  const sensor = await buildSensor({ temps: 2 });

  const short = Buffer.from(REAL_FRAME.subarray(0, 28));
  assert.equal(sensor.getPath("temp0").read(short), null);
  assert.equal(sensor.getPath("temp1").read(short), null);
});

test("temperature reaches a subscriber end to end", async () => {
  const sensor = await buildSensor();

  const seen = [];
  sensor.on("temp0", (v) => seen.push(v));
  sensor.emitData("temp0", REAL_FRAME);

  assert.deepEqual(seen, [297.6], "emitData must reach the registered tag");
});

test("primary temperature lands on the standard SignalK battery path", async () => {
  const sensor = await buildSensor({ temps: 2 });

  assert.equal(
    sensor.getPath("temp0").default,
    "electrical.batteries.{batteryID}.temperature"
  );
  assert.equal(
    sensor.getPath("temp1").default,
    "electrical.batteries.{batteryID}.Temperature2"
  );
});

// The protection callback used to `return` its status object before reaching
// the code that raises the alert, so the decoded value looked correct while no
// notification was ever emitted.
test("raises a notification naming the active protection flags", async () => {
  const app = appStub();
  const sensor = await buildSensor({ app });

  // Checksum is deliberately left stale; read() decodes without verifying.
  const faulted = Buffer.from(REAL_FRAME);
  faulted.writeUInt16BE(0x0005, 20); // singleCellOvervolt + packOvervolt

  const status = sensor.getPath("protectionStatus").read(faulted);
  assert.equal(status.singleCellOvervolt, true);
  assert.equal(status.packOvervolt, true);
  assert.equal(status.chargeOvercurrent, false);

  assert.equal(app.deltas.length, 1, "a fault must emit exactly one delta");
  const { path, value } = app.deltas[0].updates[0].values[0];
  assert.match(path, /^notifications\./);
  assert.equal(value.state, "alert");
  assert.match(value.message, /singleCellOvervolt/);
  assert.match(value.message, /packOvervolt/);
});

test("clears the notification when no protection is active", async () => {
  const app = appStub();
  const sensor = await buildSensor({ app });

  const status = sensor.getPath("protectionStatus").read(REAL_FRAME);
  assert.equal(
    Object.values(status).some(Boolean),
    false,
    "captured frame is fault-free"
  );

  assert.equal(app.deltas.length, 1);
  assert.equal(
    app.deltas[0].updates[0].values[0].value,
    null,
    "a clean read must clear any standing alert"
  );
});
