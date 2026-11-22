import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMinistry, upcomingWeeklyDates, churchClock, shiftIsUpcoming, TIME_ZONE } from "../serve-model.js";

test("ministry data matches Firestore name/description limits",()=>{
 assert.deepEqual(normalizeMinistry("  Children's Church  ","  Weekly care  "),{
  name:"Children's Church",description:"Weekly care"
 });
 assert.throws(()=>normalizeMinistry("A"),/between 2 and 80/);
 assert.throws(()=>normalizeMinistry("x".repeat(81)),/between 2 and 80/);
 assert.throws(()=>normalizeMinistry("Children","x".repeat(501)),/500/);
});
test("church time and five Sundays from Saturday 21 November 2026",()=>{
 assert.equal(TIME_ZONE,"America/Chicago");
 const now=new Date("2026-11-22T04:00:00Z"); // Saturday 10 PM CT
 assert.equal(churchClock(now),"2026-11-21T22:00");
 assert.deepEqual(upcomingWeeklyDates(0,"10:00",5,now),[
  "2026-11-22","2026-11-29","2026-12-06","2026-12-13","2026-12-20"
 ]);
});
test("past Sunday rolls out when service has ended",()=>{
 const now=new Date("2026-11-22T17:00:00Z"); // Sunday 11 AM CT
 assert.equal(upcomingWeeklyDates(0,"10:00",1,now)[0],"2026-11-29");
});
test("Sunday still offered before its ending",()=>{
 const now=new Date("2026-11-22T15:00:00Z"); // Sunday 9 AM CT
 assert.equal(upcomingWeeklyDates(0,"10:00",1,now)[0],"2026-11-22");
});
test("four and thirteen weekly commitment dates",()=>{
 const now=new Date("2026-11-22T04:00:00Z");
 assert.equal(upcomingWeeklyDates(0,"10:00",4,now).length,4);
 assert.equal(upcomingWeeklyDates(0,"10:00",13,now).length,13);
 assert.equal(upcomingWeeklyDates(0,"10:00",13,now).at(-1),"2027-02-14");
});
test("past one-time shifts hidden without deleting documents",()=>{
 const now=new Date("2026-11-22T17:00:00Z");
 assert.equal(shiftIsUpcoming("2026-11-22T09:00",now),false);
 assert.equal(shiftIsUpcoming("2026-11-29T09:00",now),true);
});
