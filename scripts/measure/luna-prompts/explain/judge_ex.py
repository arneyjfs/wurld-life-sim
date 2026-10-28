import json, re, sys, os, glob, statistics, concurrent.futures as cf
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, f"{H}/../holdout"); sys.path.insert(0, "/home/user/wurld-app/tests/prompts/_shared")
from verify_holdout import gemini
from openai_call import call_openai
def sol(p): return call_openai("gpt-6.1-sol", "You are a strict language teacher reviewing a learning app.", p, reasoning="low", max_output_tokens=900, tries=2)[0]
C = {c["id"]: c for c in json.load(open(f"{H}/explain_cases.json")) + json.load(open(f"{H}/practice_cases.json"))}
PE = """A language app explained this translation to a learner of {t} whose native language is {n} (level: improver).
Original {ol} message: {o}
{t} translation shown to the learner: {tr}

App's explanation (XML; <vocab phrase=.. translation=../> tags teach words):
{x}

Score 1-5: 5 = the review score and sentence are accurate about the translation's real strengths/errors, the sections are correct, specific and useful, short, and ALL prose is in {n}; 4 = good with a small inaccuracy or padding; 3 = generic, or misses the translation's main error, or partly in the wrong language; 2 = a factual error about the language; 1 = mostly wrong or mostly in the wrong language.
Reply JSON only: {{"score": 1-5, "native_ok": true|false, "note": "<short>"}}"""
PP = """A language app reviewed a quiz answer for a learner of {p} (native {n}).
Question: {q}
Learner's answer: {a}   System verdict: {v}
Expected review: {e}

App's explanation:
{x}

Score 1-5: 5 = the verdict (correct/incorrect/overturned) is right, the reasoning is accurate, sections useful and short, ALL prose in {n}; 3 = verdict right but reasoning weak/generic or partly wrong language; 1 = wrong verdict or factually wrong. (If the expected review allows two verdicts, either is fine.)
Reply JSON only: {{"score": 1-5, "native_ok": true|false, "note": "<short>"}}"""
def j(fn, p):
    try: return json.loads(re.search(r"\{[\s\S]*\}", fn(p)).group(0))
    except Exception: return {}
def mech(x):
    bad = []
    if not re.search(r"<explanation>[\s\S]*</explanation>", x): bad.append("no-envelope")
    if re.search(r"<vocab\b[^>]*[^/]>", x): bad.append("vocab-not-selfclosing")
    if "```" in x: bad.append("fence")
    return bad
for d in sys.argv[1:]:
    rows = []
    def work(f):
        cid = os.path.basename(f)[:-4]; c = C[cid]; x = open(f).read()
        if c["id"].startswith("E-"):
            p = PE.format(t=c["target"], n=c["native"], ol=c["originalLanguage"], o=c["original"], tr=c["translated"], x=x)
        else:
            p = PP.format(p=c["practice"], n=c["native"], q=json.dumps(c["q"], ensure_ascii=False), a=c["userAnswer"], v="correct" if c["wasCorrect"] else "incorrect", e=c["expect"], x=x)
        a, b = j(gemini, p), j(sol, p)
        return {"id": cid, "g": a.get("score"), "s": b.get("score"), "nat": [a.get("native_ok"), b.get("native_ok")], "mech": mech(x), "gn": a.get("note"), "sn": b.get("note")}
    with cf.ThreadPoolExecutor(12) as ex: rows = list(ex.map(work, sorted(glob.glob(f"{d}/*.txt"))))
    json.dump(rows, open(f"{d}/judged.json", "w"), ensure_ascii=False, indent=1)
    for k in ("E-", "P"):
        R = [r for r in rows if r["id"].startswith(k)]
        sc = [((r["g"] or 0) + (r["s"] or r["g"] or 0)) / 2 for r in R]
        print(f"{d} {k}: mean {statistics.mean(sc):.2f}  <=3: {sum(x<=3 for x in sc)}  native-fail {sum(1 for r in R if False in r['nat'])}  mech {sum(1 for r in R if r['mech'])}", flush=True)
