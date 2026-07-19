import { createServer } from "node:http";
import { decideScholarship } from "./eligibility.mjs";

const port = Number(process.env.PORT ?? 4101);

const form = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Scholarship decision</title></head>
<body><main><h1>Scholarship decision</h1><form id="decision-form">
<label>Income <input id="income" name="income" inputmode="numeric"></label>
<label>Age <input id="age" name="age" inputmode="numeric"></label>
<label><input id="disability" type="checkbox"> Disability exception</label>
<button type="submit">Check</button></form>
<output id="outcome"></output><p id="explanation"></p></main>
<script>document.querySelector('#decision-form').addEventListener('submit',async(event)=>{event.preventDefault();const response=await fetch('/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({applicant:{annualHouseholdIncome:document.querySelector('#income').value,age:document.querySelector('#age').value,hasDisability:document.querySelector('#disability').checked}})});const result=await response.json();document.querySelector('#outcome').textContent=result.decision.code;document.querySelector('#explanation').textContent=result.decision.explanation;});</script>
</body></html>`;

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(form);
    return;
  }
  if (request.method !== "POST" || request.url !== "/decision") {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    const facts = JSON.parse(body || "{}");
    const decision = decideScholarship(facts.applicant ?? {});
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        decision: {
          code: decision.outcomeCode,
          explanation: decision.explanation,
        },
      }),
    );
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Node decision app listening on http://127.0.0.1:${port}`);
});
