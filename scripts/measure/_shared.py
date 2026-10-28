"""Shared plumbing for the migration measurements.

Loads the key the same way the prompt-eval suites do, prices calls from the
VERIFIED rate table, and refuses to price a model it does not know rather
than silently under-reporting.
"""
from __future__ import annotations
import json, os, statistics, time, urllib.request
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tests/prompts/_shared"))
from openai_call import call_openai, is_openai  # noqa: E402

def _load_env_local() -> None:
    p = REPO / ".env.local"
    if not p.exists():
        return
    for raw in p.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

_load_env_local()

def api_key() -> str:
    k = os.environ.get("GEMINI_API_KEY", "")
    if not k:
        raise SystemExit("GEMINI_API_KEY not set (see scripts/measure/README.md)")
    return k

# USD per 1M tokens, paid tier, text. Mirrors src/lib/life/geminiPricing.ts.
# Verified 2026-07-25 against https://ai.google.dev/gemini-api/docs/pricing
RATES = {
    "gemini-3.1-flash-lite":   (0.25, 1.50, 0.025),
    "gemini-3.5-flash-lite":   (0.30, 2.50, 0.03),
    "gemini-3-flash-preview":  (0.50, 3.00, 0.05),
    "gemini-2.5-flash":        (0.30, 2.50, 0.03),
    # OpenAI adds a 4th rate: cache WRITES bill at 1.25x input. Verified
    # 2026-09-24 against https://developers.openai.com/api/docs/models/gpt-6-luna
    "gpt-6-luna":              (0.10, 0.50, 0.01, 0.125),
}

def price(model: str, prompt_tok: int, out_tok: int, cached_tok: int = 0,
          write_tok: int = 0) -> float:
    """Cost of one call.

    `out_tok` MUST already include thinking tokens (OBS-USAGE-2): Gemini
    reports prompt/candidates/thoughts as DISJOINT sets but bills thinking at
    the output rate, so counting candidates alone under-reports.
    `prompt_tok` INCLUDES the cached portion, so the cached part is billed at
    the cache rate and only the remainder at the input rate. `write_tok`
    (OpenAI's cache_write_tokens) is also inside `prompt_tok`.
    """
    if model not in RATES:
        raise KeyError(f"no verified rate for {model} — add it rather than guess")
    ri, ro, rc, *rw = RATES[model]
    uncached = max(0, prompt_tok - cached_tok - write_tok)
    return (uncached * ri + cached_tok * rc + write_tok * (rw[0] if rw else ri)
            + out_tok * ro) / 1e6

def generate(model: str, si: str, prompt: str, *, thinking: str = "minimal",
             mime: str | None = None, temperature: float = 0.7,
             max_output_tokens: int = 8192, schema: dict | None = None,
             tries: int = 4, timeout: int = 300) -> tuple[str, dict, int]:
    """One call. Returns (text, usage, latency_ms). Retries transient errors.
    A `gpt-*` model routes to OpenAI (usage comes back in Gemini's shape)."""
    if is_openai(model):
        return call_openai(model, si, prompt, schema=schema, temperature=temperature,
                           max_output_tokens=max_output_tokens,
                           reasoning=None if thinking == "minimal" else thinking,
                           timeout=timeout, tries=max(tries, 8))
    cfg: dict = {"temperature": temperature, "maxOutputTokens": max_output_tokens,
                 "thinkingConfig": {"thinkingLevel": thinking, "includeThoughts": True}}
    if mime:
        cfg["responseMimeType"] = mime
    if schema:
        cfg["responseSchema"] = schema
    body = {"systemInstruction": {"parts": [{"text": si}]},
            "contents": [{"parts": [{"text": prompt}]}], "generationConfig": cfg}
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={api_key()}")
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                d = json.loads(resp.read())
            ms = int((time.time() - t0) * 1000)
            parts = d["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            return text, d.get("usageMetadata", {}), ms
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt == tries - 1:
                break
            time.sleep(2 ** attempt)
    raise RuntimeError(f"generate failed after {tries} tries: {last}")

def billed_out(usage: dict) -> int:
    """Candidates + thoughts — what Google actually bills as output."""
    return int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)

def strip_fences(t: str) -> str:
    t = t.strip()
    if t.startswith("```"):
        lines = t.split("\n"); lines.pop(0)
        if lines and lines[-1].startswith("```"): lines.pop()
        t = "\n".join(lines).strip()
    return t

def load_si_verbatim(ts_path: str, const: str) -> str:
    """Extract a template-literal SI from a .ts file, VERBATIM.

    Guard against the harness-contamination bug: callers must pass this
    straight to generate() with nothing appended.
    """
    src = (REPO / ts_path).read_text()
    return src.split(f"{const} = `", 1)[1].split("`;", 1)[0]

def summarise(name: str, rows: list[dict]) -> dict:
    """Median latency, mean tokens, mean cost — printed identically everywhere."""
    if not rows:
        return {}
    return {
        "n": len(rows),
        "lat_median_ms": statistics.median(r["ms"] for r in rows),
        "in_mean": statistics.mean(r["in"] for r in rows),
        "out_mean": statistics.mean(r["out"] for r in rows),
        "usd_mean": statistics.mean(r["usd"] for r in rows),
    }
