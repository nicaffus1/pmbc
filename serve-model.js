// Pure scheduling and input rules. No Firebase or browser dependencies.
export const TIME_ZONE = "America/Chicago";
export const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const buildId = "rebuild-v2.1";

export function normalizeMinistry(name, description = "") {
  const cleanName = String(name ?? "").trim();
  const cleanDescription = String(description ?? "").trim();
  if (cleanName.length < 2 || cleanName.length > 80)
    throw new Error("Ministry name must be between 2 and 80 characters.");
  if (cleanDescription.length > 500)
    throw new Error("Description must be 500 characters or fewer.");
  return { name: cleanName, description: cleanDescription };
}
export function churchClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE, year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", hourCycle:"h23"
    }).formatToParts(now).map(p => [p.type,p.value])
  );
  return parts.year+"-"+parts.month+"-"+parts.day+"T"+parts.hour+":"+parts.minute;
}
export function upcomingWeeklyDates(weekday, endTime, count=5, now=new Date()) {
  if(!Number.isInteger(weekday) || weekday<0 || weekday>6)throw new Error("Invalid weekday");
  if(!Number.isInteger(count) || count<1 || count>13)throw new Error("Invalid window");
  if(!/^\d{2}:\d{2}$/.test(endTime))throw new Error("Invalid end time");
  const current=churchClock(now);
  const isoDay=current.slice(0,10);
  const utc=new Date(isoDay+"T12:00:00Z");
  let distance=(weekday-utc.getUTCDay()+7)%7;
  if(distance===0 && endTime<=current.slice(11))distance=7;
  return Array.from({length:count},(_,i)=>
    new Date(utc.getTime()+(distance+7*i)*86400000).toISOString().slice(0,10)
  );
}
export function shiftIsUpcoming(endAt, now=new Date()) {
  return typeof endAt==="string" && endAt>=churchClock(now);
}
