// End-to-end test of the real PMBC UI against local Firebase emulators only.
// The production project is never used when the page is on 127.0.0.1/?emulator.
import {test,expect} from "@playwright/test";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {setDoc,doc} from "firebase/firestore";
import {readFileSync} from "node:fs";

test("administrator can create a ministry on a phone, view it and reload",async({page})=>{
 const email="admin-ui@pmbc.test",password="TestOnly12345!";
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
  await page.locator('#ministryName').fill("Children's Church");
  await page.locator('#ministryDescription').fill("Sunday morning volunteers");
  await page.locator("#addMinistryButton").click();
  await expect(page.locator("#serveMessage")).toContainText("Ministry saved",{timeout:15000});
  await expect(page.locator("#ministryPicker")).toHaveValue(/.+/);
  await expect(page.getByRole("heading",{name:"Children's Church"})).toBeVisible();
  await page.reload();
  await expect(page.locator("#ministryPicker")).toContainText("Children's Church");
  expect(pageErrors).toEqual([]);
 }finally{await env.cleanup();}
});
