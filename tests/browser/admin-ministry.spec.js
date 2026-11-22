// End-to-end test of the real PMBC UI against local Firebase emulators only.
// The production project is never used when the page is on 127.0.0.1/?emulator.
import {test,expect} from "@playwright/test";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {setDoc,doc} from "firebase/firestore";
import {readFileSync} from "node:fs";

test("administrator can create ministries, schedule recurring serving and moderate prayers on a phone",async({page},testInfo)=>{
 const email="admin-ui-"+testInfo.project.name+"@pmbc.test",password="TestOnly12345!";
 const ministryName="Children's Church "+testInfo.project.name;
 const response=await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({email,password,returnSecureToken:true})
 });
 const data=await response.json();
 expect(response.ok,JSON.stringify(data)).toBeTruthy();
 expect(data.localId).toBeTruthy();
 const env=await initializeTestEnvironment({
  projectId:"demo-pmbc",
  firestore:{
   host:"127.0.0.1",port:8080,
   rules:readFileSync(new URL("../../firestore.rules",import.meta.url),"utf8")
  }
 });
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),"users",data.localId),{
    displayName:"Admin UI Test",
    email,role:"admin",status:"approved",createdAt:new Date()
   });
  });
  const pageErrors=[];
  page.on("pageerror",err=>pageErrors.push(err.message));
  await page.goto("/?emulator#more");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('#authForm button[type="submit"]').click();
  await expect(page.getByText("Admin UI Test")).toBeVisible();
  await page.locator('[data-tab="serve"]').click();
  await expect(page.getByText("Create a Ministry")).toBeVisible();
  await expect(page.locator("#serveBuildVersion")).toContainText("rebuild-v2");
  await page.locator('#ministryName').fill(ministryName);
  await page.locator('#ministryDescription').fill("Sunday morning volunteers");
  await page.locator("#addMinistryButton").click();
  await expect(page.locator("#serveMessage")).toContainText("Ministry saved",{timeout:15000});
  await expect(page.locator("#ministryPicker")).toHaveValue(/.+/);
  await expect(page.getByRole("heading",{name:ministryName})).toBeVisible();
  await page.reload();
  await expect(page.locator("#ministryPicker")).toContainText(ministryName);
  // Step 2: select a ministry and create a volunteer position.
  await page.locator("#ministryPicker").selectOption({label:ministryName});
  await page.locator('[data-position-form] [name="title"]').fill("Classroom Helper");
  await page.locator('[data-position-form] button[type="submit"]').click();
  await expect(page.locator("#serveMessage")).toContainText("Volunteer position added");
  await expect(page.getByText("Classroom Helper",{exact:true})).toBeVisible();

  // Step 3: create a reusable weekly Children's Church schedule.
  await page.locator('[data-recurring-form] [name="title"]').fill("Weekly Children's Church");
  await page.locator('[data-recurring-form] [name="start"]').fill("09:00");
  await page.locator('[data-recurring-form] [name="end"]').fill("10:00");
  await page.locator('[data-recurring-form] button[type="submit"]').click();
  await expect(page.locator("#serveMessage")).toContainText("Weekly schedule created");
  await expect(page.locator(".recurring-occurrence")).toHaveCount(5);

  // Step 4: a volunteer can join one occurrence, then all four weeks.
  await page.locator("[data-recurring-signup]").first().click();
  await expect(page.locator("#serveMessage")).toContainText("signed up for this date");
  page.on("dialog",dialog=>dialog.accept());
  await page.locator('[data-recurring-bulk][data-count="4"]').first().click();
  await expect(page.locator("#serveMessage")).toContainText("Signed up for");

  // Step 5: archive and restore a position without deleting the history.
  await page.locator("[data-position-archive]").first().click();
  await expect(page.locator("#serveMessage")).toContainText("removed from active ministries");
  await page.locator(".archived-positions summary").first().click();
  await page.locator("[data-position-restore]").first().click();
  await expect(page.locator("#serveMessage")).toContainText("Position restored");

  // Step 6: an administrator can remove and restore a test prayer.
  await page.locator('[data-tab="prayer"]').click();
  await page.locator("#requestText").fill("Prayer requested for the test event.");
  await page.locator("#savePrayer").click();
  await expect(page.locator("#prayerNotice")).toContainText("posted");
  await page.locator("[data-remove-prayer]").first().click();
  await expect(page.locator("#prayerNotice")).toContainText("removed from member views");
  await page.locator("[data-remove-prayer]").first().click();
  await expect(page.locator("#prayerNotice")).toContainText("restored");

  expect(pageErrors).toEqual([]);
 }finally{await env.cleanup();}
});
