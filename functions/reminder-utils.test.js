"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {chicagoMinute,moveMinutes,dueWithin,reminderId,niceDate}=require("./reminder-utils");

test("Central local time formatting handles DST periods",()=>{
 assert.equal(chicagoMinute(new Date("2026-11-22T15:20:00Z")),"2026-11-22T09:20");
 assert.equal(chicagoMinute(new Date("2026-07-22T15:20:00Z")),"2026-07-22T10:20");
});
test("event and shift reminders fire in the due window, not early",()=>{
 assert.equal(dueWithin("2026-11-23T09:30","2026-11-22T09:15",24),true);
 assert.equal(dueWithin("2026-11-23T10:00","2026-11-22T09:15",24),false);
 assert.equal(dueWithin("2026-11-22T10:20","2026-11-22T09:15",1),true);
 assert.equal(dueWithin("2026-11-22T09:59","2026-11-22T09:15",1),false);
});
test("minute math rolls over dates correctly",()=>{
 assert.equal(moveMinutes("2026-11-22T23:30",60),"2026-11-23T00:30");
 assert.throws(()=>moveMinutes("2026-10-32T12:00",60));
});
test("notification IDs are deterministic per reminder and recipient",()=>{
 const a=reminderId("shift","ministries/a/positions/b/shifts/c","2026-11-22T10:00","user1");
 assert.equal(a,reminderId("shift","ministries/a/positions/b/shifts/c","2026-11-22T10:00","user1"));
 assert.notEqual(a,reminderId("shift","ministries/a/positions/b/shifts/c","2026-11-22T10:00","user2"));
 assert.match(a,/^auto-[a-f0-9]{36}$/);
});
test("display dates are human readable",()=>{
 assert.match(niceDate("2026-11-22T10:30"),/10:30 AM Central/);
});
