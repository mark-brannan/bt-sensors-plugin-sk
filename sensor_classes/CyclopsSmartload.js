const BTSensor = require("../BTSensor");

const FULL_MANUFACTURER_ID = Buffer.from([0xc3, 0x04]);

const STATUS_FLAGS = [
    "Channel A overflow",
    "Channel B overflow",
    "Channel A hardware fault on sense inputs",
    "Channel B hardware fault on sense inputs",
    "Channel A hardware fault on bridge drive",
    "Channel B hardware fault on bridge drive"
];

function tonnesToKg(tonnes){
    return parseFloat((tonnes * 1000).toFixed(5));
}

class CyclopsSmartload extends BTSensor{
    static Domain = BTSensor.SensorDomains.load
    static Manufacturer = "Cyclops Marine"
    static manufacturerID = 0x04c3
    static dataServiceUUID = "0000ffb0-0000-1000-8000-00805f9b34fb"
    static advertisementProtocol = 0x01
    static advertisementKey = Buffer.from([
        0x60, 0xa9, 0x6c, 0x64, 0x1f,
        0x71, 0x11, 0x4a, 0x16, 0x75
    ])
    static characteristics = {
        channelA: "0000ffb1-0000-1000-8000-00805f9b34fb",
        channelB: "0000ffb2-0000-1000-8000-00805f9b34fb",
        temperature: "0000ffb3-0000-1000-8000-00805f9b34fb",
        battery: "0000ffb4-0000-1000-8000-00805f9b34fb",
        status: "0000ffb5-0000-1000-8000-00805f9b34fb"
    }

    static isSmartloadName(name){
        return !!name && (
            /^Cyc[0-9]+$/i.test(name) ||
            /^Smart\s*Load\s*(Two|2)$/i.test(name)
        );
    }

    static async identify(device){
        const name = await this.getDeviceProp(device, "Name");
        if (this.isSmartloadName(name))
            return this;

        const manufacturerData = await this.getDeviceProp(device, "ManufacturerData");
        const smartloadData = manufacturerData?.[this.manufacturerID];
        const buffer = smartloadData?.constructor?.name == "Variant" ? smartloadData.value : smartloadData;
        if (this.decodeAdvertisement(buffer))
            return this;

        return null;
    }

    static normalizeAdvertisement(buffer){
        if (!buffer || buffer.length < 11)
            return null;

        if (buffer.length >= 13 &&
            buffer[0] == FULL_MANUFACTURER_ID[0] &&
            buffer[1] == FULL_MANUFACTURER_ID[1] &&
            buffer[2] == this.advertisementProtocol) {
            return buffer.subarray(0, 13);
        }

        if (buffer[0] == this.advertisementProtocol)
            return Buffer.concat([FULL_MANUFACTURER_ID, buffer.subarray(0, 11)]);

        return null;
    }

    static decodeAdvertisement(buffer){
        const normalized = this.normalizeAdvertisement(buffer);
        if (!normalized)
            return null;

        const decoded = Buffer.alloc(this.advertisementKey.length);
        const encoded = normalized.subarray(3, 13);
        for (let i = 0; i < this.advertisementKey.length; i++)
            decoded[i] = encoded[i] ^ this.advertisementKey[i];

        const dataTag = decoded.readUInt16BE(0);
        const duplicateDataTag = decoded.readUInt16BE(8);
        if (dataTag != duplicateDataTag)
            return null;

        const tonnes = decoded.readFloatBE(4);
        return {
            manufacturerID: normalized.readUInt16LE(0),
            protocol: normalized.readUInt8(2),
            dataTag,
            status: decoded.readUInt8(2),
            units: decoded.readUInt8(3),
            tonnes,
            kg: tonnesToKg(tonnes)
        };
    }

    static decodeGATTLoad(buffer){
        if (!buffer || buffer.length < 4)
            return null;
        const tonnes = buffer.readInt32LE(0) / 10000;
        return {
            tonnes,
            kg: tonnesToKg(tonnes)
        };
    }

    static decodeTemperature(buffer){
        if (!buffer || buffer.length < 2)
            return null;
        return (buffer.readInt16LE(0) / 32) + 273.15;
    }

    static decodeBatteryStrength(buffer){
        if (!buffer || buffer.length < 1)
            return null;
        return buffer.readUInt8(0) / 100;
    }

    static decodeStatus(status){
        return STATUS_FLAGS.filter((_, bit) => status & (1 << bit));
    }

    hasGATT(){
        return true;
    }

    getGATTDescription() {
        return "Enable GATT to read Channel B, temperature, battery strength, and status in addition to advertised Channel A load.";
    }

    getManufacturer(){
        return this.constructor.Manufacturer;
    }

    initSchema(){
        super.initSchema();
        this.addDefaultParam("id")
            .default = this.getName();

        this.getGATTParams().useGATT.default = false;

        this.addMetadatum("loadA", "kg", "Channel A load",
            (reading)=>reading?.kg)
            .default = "sensors.{macAndName}.load.channelA";

        this.addMetadatum("loadATonnes", "t", "Channel A load in tonnes",
            (reading)=>reading?.tonnes)
            .default = "sensors.{macAndName}.load.channelA.tonnes";

        this.addMetadatum("loadB", "kg", "Channel B load",
            (reading)=>reading?.kg)
            .default = "sensors.{macAndName}.load.channelB";

        this.addMetadatum("loadBTonnes", "t", "Channel B load in tonnes",
            (reading)=>reading?.tonnes)
            .default = "sensors.{macAndName}.load.channelB.tonnes";

        this.addDefaultPath("batteryStrength", "sensors.batteryStrength")
            .read = this.constructor.decodeBatteryStrength;

        this.addMetadatum("temp", "K", "amplifier temperature",
            this.constructor.decodeTemperature)
            .default = "sensors.{macAndName}.temperature";

        this.addMetadatum("status", "", "load sensor status",
            (status)=>status)
            .default = "sensors.{macAndName}.status";

        this.addMetadatum("statusText", "", "load sensor status text",
            (status)=>this.constructor.decodeStatus(status))
            .default = "sensors.{macAndName}.statusText";

        this.addMetadatum("dataTag", "", "advertisement data tag",
            (reading)=>reading?.dataTag)
            .default = "sensors.{macAndName}.dataTag";
    }

    emitAdvertisedReading(buffer){
        const reading = this.constructor.decodeAdvertisement(buffer);
        if (!reading) {
            this.debug("Invalid Cyclops Smartload advertisement payload.");
            return;
        }

        this.emitData("loadA", reading);
        this.emitData("loadATonnes", reading);
        this.emitData("status", reading.status);
        this.emitData("statusText", reading.status);
        this.emitData("dataTag", reading);
    }

    emitGATTLoad(channel, buffer){
        const reading = this.constructor.decodeGATTLoad(buffer);
        if (!reading)
            return;
        this.emitData(`load${channel}`, reading);
        this.emitData(`load${channel}Tonnes`, reading);
    }

    async emitGATT(){
        if (this.characteristics.channelA)
            this.emitGATTLoad("A", await this.characteristics.channelA.readValue());
        if (this.characteristics.channelB)
            this.emitGATTLoad("B", await this.characteristics.channelB.readValue());
        if (this.characteristics.temperature)
            this.emitData("temp", await this.characteristics.temperature.readValue());
        if (this.characteristics.battery)
            this.emitData("batteryStrength", await this.characteristics.battery.readValue());
        if (this.characteristics.status) {
            const statusBuffer = await this.characteristics.status.readValue();
            if (statusBuffer?.length >= 2) {
                const status = statusBuffer.readUInt16LE(0);
                this.emitData("status", status);
                this.emitData("statusText", status);
            }
        }
    }

    async initGATTConnection(isReconnecting){
        await super.initGATTConnection(isReconnecting);
        const gattServer = await this.getGATTServer();
        const service = await gattServer.getPrimaryService(this.constructor.dataServiceUUID);
        this.characteristics = {};

        for (const tag of Object.keys(this.constructor.characteristics)) {
            try {
                this.characteristics[tag] =
                    await service.getCharacteristic(this.constructor.characteristics[tag]);
            } catch(e) {
                this.debug(`Characteristic ${tag} unavailable: ${e.message}`);
            }
        }
    }

    async initGATTNotifications() {
        await this.emitGATT();

        if (this.characteristics.channelA) {
            await this.characteristics.channelA.startNotifications();
            this.characteristics.channelA.on("valuechanged", (buffer) => {
                this.emitGATTLoad("A", buffer);
            });
        }

        if (this.characteristics.channelB) {
            await this.characteristics.channelB.startNotifications();
            this.characteristics.channelB.on("valuechanged", (buffer) => {
                this.emitGATTLoad("B", buffer);
            });
        }

        if (this.characteristics.temperature) {
            await this.characteristics.temperature.startNotifications();
            this.characteristics.temperature.on("valuechanged", (buffer) => {
                this.emitData("temp", buffer);
            });
        }
    }

    async deactivateGATT(){
        if (this.characteristics) {
            await this.stopGATTNotifications(this.characteristics.channelA);
            await this.stopGATTNotifications(this.characteristics.channelB);
            await this.stopGATTNotifications(this.characteristics.temperature);
        }
        await super.deactivateGATT();
    }

    propertiesChanged(props){
        super.propertiesChanged(props);
        if (props.ManufacturerData)
            this.emitAdvertisedReading(this.getManufacturerData(this.constructor.manufacturerID));
    }
}

module.exports = CyclopsSmartload;
