import json
import sys

from eligibility import decide_scholarship


facts = json.loads(sys.stdin.read() or "{}")
print(json.dumps(decide_scholarship(facts.get("applicant", {}))))
