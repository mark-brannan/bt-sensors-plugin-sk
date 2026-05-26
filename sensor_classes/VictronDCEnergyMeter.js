
const VictronSensor = require("./Victron/VictronSensor");
const VC=require("./Victron/VictronConstants.js")
const int24 = require("int24");
const _BitReader = require("./_BitReader.js");


class VictronDCEnergyMeter extends VictronSensor{

    meterCategory = "dcload" 
    auxMode=VC.AuxMode.DISABLED

     async init(){
        
        try {
        if (this.encryptionKey){
            const decData = this.decrypt(this.getManufacturerData(0x02e1))
            if (decData) {
                this.auxMode=decData.readInt8(8)&0x3   
                this.meterCategory=VC.MeterType.get(decData.readInt16LE(0)).category??"dcload"                
            } else
                throw new Error("Null decrypted Manufacturer Data")
        }
        } catch(e){ 
            this.debug(`Unable to determine device AuxMode and/or MeterType. ${e.message}`)
            this.debug(e)
            this.auxMode=VC.AuxMode.DISABLED
        }
        await super.init()


    }
    initSchema(){
        super.initSchema()
        this.addDefaultParam("id")
        this.addMetadatum('meterType','', 'meter type', 
            (buff)=>{return VC.MeterType.get( buff.readInt16LE(0))})
            .default="electrical.{meterCategory}.{id}.type"

        this.addMetadatum('voltage','V','voltage',
            (buff)=>{return buff.readInt16LE(2)/100})
            .default="electrical.{meterCategory}.{id}.voltage"
         
        this.addMetadatum('alarm','', 'alarm', 
            (buff)=>{return buff.readUInt16LE(4)})
           .default="electrical.{meterCategory}.{id}.alarm"
        this.addMetadatum('current','A', 'current')
        .default="electrical.{meterCategory}.{id}.current"       



        switch(this.auxMode){
            case VC.AuxMode.STARTER_VOLTAGE:
                this.addMetadatum('auxVoltage','V',  'auxiliary voltage', 
                        (buff,offset=0)=>{return buff.readInt16LE(offset)/100})
                        .default="electrical.{meterType}.{id}.auxVoltage"
                        break;

            case VC.AuxMode.TEMPERATURE:
                this.addMetadatum('temperature','K','temperature', 
                    (buff,offset=0)=>{
                        const temp = buff.readUInt16LE(offset)
                        if (temp==0xffff) 
                            return null
                        else 
                            return temp / 100
                    })
                    .default="electrical.{meterType}.{id}.temperature"

                    break;
            default:
                break
        }
 
    }
    
    emitValuesFrom(decData){
        this.emitData("meterType",decData,0)
        this.emitData("voltage",decData,2);
        const alarm = this.getPath("alarm").read(decData,4)
        if (alarm>0){
            this.emitAlarm("alarm",alarm)
        }
        switch(this.auxMode){
            case VC.AuxMode.STARTER_VOLTAGE:
                this.emitData("starterVoltage",decData,6);
                break;
            case VC.AuxMode.TEMPERATURE:
                this.emitData("temperature",decData,6);
                break;
            default:
                break
            } 
        const br = new _BitReader(decData.subarray(8,11)) //current is packed into final 22 bytes
        br.read_unsigned_int(2) //discard first two bytes (auxMode)
        this.emit("current", 
            this.NaNif( br.read_signed_int(22),0x3FFFFF)/1000
        )
  
    }
    

}
module.exports=VictronDCEnergyMeter 