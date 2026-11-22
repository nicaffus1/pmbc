import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = file => readFileSync(new URL("../"+file,import.meta.url),"utf8");
test("Firestore rules have only one complete global fallback",()=>{
 const rules=read("firestore.rules");
 assert.equal((rules.match(/match \/\{document=\*\*\}/g)||[]).length,1);
 assert.equal((rules.match(/match \/ministries\/\{ministryId\}/g)||[]).length,1);
 assert.equal((rules.match(/match \/recurring\/\{scheduleId\}/g)||[]).length,1);
 assert.match(rules,/allow create: if isAdmin\(\)/);
 assert.match(rules,/data.status != 'removed'/);
 assert.match(rules,/^\}\s*$/m);
 assert.ok(rules.trimEnd().endsWith("}\n}".trimEnd()));
});
test("Serve uses an independently bound ministry action",()=>{
 const serve=read("serve.js");
 assert.match(serve,/import \{ createMinistry, observeMinistries \} from "\.\/ministry-data\.js"/);
 assert.match(serve,/addMinistryButton/);
 assert.match(serve,/addEventListener\("click",event=>/);
 assert.match(serve,/createMinistry\(\{name,description,uid:account\.uid\}\)/);
});
test("service worker caches the ministry repository and scheduling model",()=>{
 const sw=read("service-worker.js");
 assert.ok(sw.includes("./ministry-data.js"));
 assert.ok(sw.includes("./serve-model.js"));
});
