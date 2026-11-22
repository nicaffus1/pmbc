import {defineConfig} from "@playwright/test";
export default defineConfig({
 testDir:"./tests/browser",
 timeout:45000,
 retries:0,
 workers:1,
 use:{
  baseURL:"http://127.0.0.1:4173",

  viewport:{width:390,height:844},
  trace:"retain-on-failure"
 },
 projects:[
  {name:"chromium-mobile",use:{browserName:"chromium"}},
  {name:"safari-webkit-mobile",use:{browserName:"webkit"}}
 ],
 webServer:{
  command:"npx http-server . -a 127.0.0.1 -p 4173 -c-1",
  url:"http://127.0.0.1:4173",
  reuseExistingServer:!process.env.CI,
  timeout:60000
 }
});
