import { decideScholarship } from "./eligibility.mjs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const facts = JSON.parse(input || "{}");
  console.log(JSON.stringify(decideScholarship(facts.applicant ?? {})));
});
