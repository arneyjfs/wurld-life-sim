"""run_ex.py ARM OUT  ARM=gem (prod prompts on Gemini) | luna-port | luna-bb"""
import json, sys, os, subprocess, concurrent.futures as cf
sys.path.insert(0, "/home/user/wurld-app/tests/prompts/_shared")
arm, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
H = os.path.dirname(os.path.abspath(__file__))
E = json.load(open(f"{H}/explain_cases.json")); P = json.load(open(f"{H}/practice_cases.json"))
js = r'''
const m = require("/home/user/wurld-app/functions/lib/prompts/explain.js");
const {E, P} = JSON.parse(require("fs").readFileSync(0, "utf8"));
const o = {};
for (const c of E) o[c.id] = {si: m.explainMessageSystemInstruction(c.target, c.native), u: m.explainMessagePrompt({originalText: c.original, originalLanguage: c.originalLanguage, translatedText: c.translated, targetLanguage: c.target, nativeLanguage: c.native, wordDifficulty: c.level})};
for (const c of P) o[c.id] = {si: m.explainPracticeAnswerSystemInstruction(c.practice, c.native), u: m.explainPracticeAnswerPrompt({question: c.q, userAnswer: c.userAnswer, wasCorrect: c.wasCorrect, practiceLanguage: c.practice, nativeLanguage: c.native, wordDifficulty: 3})};
process.stdout.write(JSON.stringify(o));
'''
prod = json.loads(subprocess.run(["node", "-e", js], input=json.dumps({"E": E, "P": P}), capture_output=True, text=True, check=True).stdout)
if arm != "gem": os.environ["PROMPT_TEST_MODEL"] = "gpt-6-luna"
from gemini_call import call_gemini
te, tp = open(f"{H}/bb_explain.tmpl").read(), open(f"{H}/bb_practice.tmpl").read()
jobs = []
TAIL = os.environ.get("EX_TAIL") == "1"
for c in E: jobs.append((c["id"], te.replace("{P}", c["target"]).replace("{N}", c["native"]) if arm == "luna-bb" else prod[c["id"]]["si"], prod[c["id"]]["u"] + (f"\n\nWrite your explanation in {c['native']}." if TAIL else "")))
for c in P: jobs.append((c["id"], tp.replace("{P}", c["practice"]).replace("{N}", c["native"]) if arm == "luna-bb" else prod[c["id"]]["si"], prod[c["id"]]["u"] + (f"\n\nWrite your explanation in {c['native']}." if TAIL else "")))
def work(j):
    cid, si, u = j
    try: o = call_gemini(si, u, temperature=1.0, max_output_tokens=2048)
    except Exception as e: o = f"__ERROR__ {e}"
    open(f"{out}/{cid}.txt", "w").write(o)
with cf.ThreadPoolExecutor(6) as ex: list(ex.map(work, jobs))
print(out, len(jobs))
