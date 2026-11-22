"use strict";
const crypto = require("node:crypto");
const CHICAGO = "America/Chicago";
const pad = n=>String(n).padStart(2,"0");
function chicagoMinute(now=new Date()){
 const values={};
 for(const p of new Intl.DateTimeFormat("en-US",{
  timeZone:CHICAGO,year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",hourCycle:"h23"
 }).formatToParts(now))values[p.type]=p.value;
 return values.year+"-"+values.month+"-"+values.day+"T"+values.hour+":"+values.minute;
}
// Perform date arithmetic on Central wall-clock strings without accidentally
// formatting scheduled dates in the server's UTC timezone.
function moveMinutes(value,offset){
 const d=new Date(value+":00Z");
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,16)!==value)
  throw Error("Invalid wall-clock datetime");
 return new Date(d.getTime()+offset*60000).toISOString().slice(0,16);
}
function dueWithin(start,now,hoursBefore,windowMinutes=30){
 const target=moveMinutes(now,hoursBefore*60);
 return start>=target&&start<moveMinutes(target,windowMinutes);
}
function reminderId(...fields){
 return "auto-"+crypto.createHash("sha256").update(fields.join("|")).digest("hex").slice(0,36);
}
function niceDate(value){
 const d=new Date(value.slice(0,10)+"T12:00:00Z");
 const date=d.toLocaleDateString("en-US",{timeZone:"UTC",weekday:"short",month:"short",day:"numeric"});
 const [hour,minute]=value.slice(11).split(":").map(Number);
 const time=new Date(2020,0,1,hour,minute).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
 return date+" at "+time+" Central";
}
module.exports={chicagoMinute,moveMinutes,dueWithin,reminderId,niceDate};
