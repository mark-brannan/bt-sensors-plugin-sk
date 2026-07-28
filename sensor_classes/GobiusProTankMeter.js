const BTSensor = require("../BTSensor");

const GobiusLevelState = new Map([
        [0, "invalid"],
        [1, "belowSensor"],
        [2, "aboveSensor"]
])
class GobiusProTankMeter extends BTSensor{
    static Domain = BTSensor.SensorDomains.tanks
		
    static async identify(device){
        const name = await this.getDeviceProp(device,"Name")
        if (name && name.toLowerCase().startsWith('gobius pro'))
            return this 
        else
            return null
    }

    static ImageFile = "GobiusProTankMeter.png"
    static Manufacturer = "Gobius Sensor Tech"
    static Description = "Gobius Pro Tank Meter"

    pollFreq = 30
    
    getManufacturer(){
        return GobiusProTankMeter.Manufacturer
    }

    hasGATT(){
        return true
    }
    usingGATT(){
        return true
    }
    emitGATT(){
        this.characteristic.readValue()
        .then((buffer)=>
            this.emitValuesFrom(buffer)
        )

    }

    initSchema(){
        super.initSchema()
        this.getGATTParams()["useGATT"].default=true
        this.getGATTParams()["pollFreq"].default = this.pollFreq

        this.addParameter("type",{
            tag: "type",
            description:"Type of tank",
            enum: [
                "petrol",
                "freshWater",
                "greyWater",
                "blackWater",
                "holding",
                "lpg",
                "diesel",
                "liveWell",
                "baitWell",
                "ballast",
                "rum"
              ]
        })

        this.addDefaultParam("id")
                .default="1"

        this.addMetadatum("mls","","Measurement level state (0 invalid, 1 below sensor, 2 above sensor)",
            (buffer)=>{
                if (buffer.length < 1) return null
                return GobiusLevelState.get(buffer.readUInt8(0)) ?? "unknown"
            }
        )
        .default='tanks.{type}.{id}.levelState'

        this.addMetadatum("mlms","","Measurement LMS value",
            (buffer)=>{
                if (buffer.length < 5) return null
                return buffer.readUInt32BE(1)
            }
        )
        .default='tanks.{type}.{id}.measurementLMS'

        this.addMetadatum("mbgnl","","Background noise level (unit mg)",
            (buffer)=>{
                if (buffer.length < 9) return null
                return buffer.readUInt32BE(5)
            }
        )
        .default='tanks.{type}.{id}.measurementNoiseLevel'
        
        this.addMetadatum("mtsm","","Time since measurement (s)",
            (buffer)=>{
                if (buffer.length < 13) return null
                return buffer.readUInt32BE(9)
            }
        )
        .default='tanks.{type}.{id}.timeSinceMeasurement'
        
        this.getJSONSchema().properties.params.required=["type"]
    }

    async initGATTConnection(isReconnecting){
        await super.initGATTConnection(isReconnecting) 
        const gattServer = await this.getGATTServer() 
        const service = await gattServer.getPrimaryService("0000fff0-0000-1000-8000-00805f9b34fb") 
        this.characteristic = await service.getCharacteristic("0000fff6-0000-1000-8000-00805f9b34fb")
    }

    async initGATTNotifications() {
        return
    }
   
}

module.exports=GobiusProTankMeter