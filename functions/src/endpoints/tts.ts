/**
 * Text-to-speech: Gemini TTS synthesis and the Cloud TTS voice list.
 *
 * Moved verbatim out of `index.ts` (audit: index.ts split); `index.ts`
 * re-exports the Cloud Functions defined here under their unchanged names.
 */
import { GoogleAuth } from "google-auth-library";
import { withTimeout } from "../gemini/retry";
import { onRequestV2 } from "../httpV2";
import { ALLOWED_ORIGINS, checkRateLimit, setCors } from "../httpShared";
import * as admin from "firebase-admin";
import { verifyAuth } from "../firebaseConfig";
import { Request, Response } from "express";
import { isGeminiEnabled, respondGeminiDisabled } from "../runtimeConfig";
import { ttsInputFor, ttsVoiceFor, ttsModelOrder, ttsAudioTokens } from "../ttsSynth";
import { recordTokenUsage } from "../tokenUsage";
import * as functionsV1 from "firebase-functions/v1";
import { enforceVersionFloor } from "../versionFloor";
import { withSentryHttp } from "../observability/sentry";

// ---------------------------------------------------------------------------
// 4. synthesizeSpeech — TTS via Cloud Text-to-Speech Standard voices
//    POST { text, languageCode, difficulty?, voiceGender? }
//    Streams binary WAV audio.
// ---------------------------------------------------------------------------

const CLOUD_TTS_SYNTH_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

const CLOUD_TTS_LIST_URL = "https://texttospeech.googleapis.com/v1/voices";

type TTSVoiceListResponse = {
  voices?: Array<{
    languageCodes?: string[];
    name?: string;
    ssmlGender?: string;
    naturalSampleRateHertz?: number;
  }>;
};

let ttsVoicesCache: { expiresAt: number; voices: NonNullable<TTSVoiceListResponse["voices"]> } | null = null;

async function listAllTTSVoices(apiKey: string): Promise<NonNullable<TTSVoiceListResponse["voices"]>> {
  const now = Date.now();
  if (ttsVoicesCache && ttsVoicesCache.expiresAt > now) {
    return ttsVoicesCache.voices;
  }

  // API-key auth — see synthGeminiTTS for why (gen-1 SA token lacks the
  // cloud-platform scope Cloud TTS needs).
  const res = await fetch(`${CLOUD_TTS_LIST_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "GET",
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS voices list failed (${res.status}): ${errText.slice(0, 180)}`);
  }

  const payload = await res.json() as TTSVoiceListResponse;
  const voices = payload.voices ?? [];
  ttsVoicesCache = {
    voices,
    expiresAt: now + 60 * 60 * 1000,
  };
  return voices;
}

type VoiceGender = "female" | "male";

function normalizeVoiceGender(ssmlGender: string | undefined, voiceName?: string): VoiceGender | null {
  const normalized = (ssmlGender ?? "").toUpperCase();
  if (normalized.includes("FEMALE")) return "female";
  if (normalized.includes("MALE")) return "male";

  // Fallback heuristic for providers that omit ssmlGender on some Standard voices.
  // Common Google Standard naming tends to map A/C/F/H to female and B/D/G/I to male.
  const suffixMatch = (voiceName ?? "").match(/-([A-Z])$/);
  const suffix = suffixMatch?.[1];
  if (suffix && ["A", "C", "F", "H"].includes(suffix)) return "female";
  if (suffix && ["B", "D", "G", "I"].includes(suffix)) return "male";
  return null;
}

function getStandardVoicesForLanguage(
  voices: NonNullable<TTSVoiceListResponse["voices"]>,
  languageCode: string,
): Array<{ voiceName: string; gender: VoiceGender | null }> {
  const out: Array<{ voiceName: string; gender: VoiceGender | null }> = [];
  const prefix = `${languageCode}-Standard-`;
  for (const voice of voices) {
    const name = voice.name ?? "";
    if (!name.startsWith(prefix)) continue;
    const gender = normalizeVoiceGender(voice.ssmlGender, name);
    out.push({ voiceName: name, gender });
  }
  out.sort((a, b) => a.voiceName.localeCompare(b.voiceName));
  return out;
}

function selectVoiceName(
  voices: Array<{ voiceName: string; gender: VoiceGender | null }>,
  preferredGender?: VoiceGender,
): string | null {
  if (!voices.length) return null;
  if (preferredGender) {
    const exact = voices.find((v) => v.gender === preferredGender);
    if (exact) return exact.voiceName;
  }
  return voices[0].voiceName;
}

// ─── Gemini TTS (docs/specs/tts.md) ─────────────────────────────────
// The named models live on the Cloud Text-to-Speech surface — same
// v1 synthesize endpoint as the Standard voices above, with two extra
// fields: `voice.model_name` (selects the Gemini model) and
// `input.prompt` (natural-language style instruction). The pure
// model-order / voice / style-prompt logic lives in ./ttsSynth so it's
// unit-testable without the functions runtime (TTS-ENGINE-1/2).

/**
 * Synthesise via Gemini TTS, trying each model in `models` order with
 * one retry apiece. The documented failure mode "returns text instead
 * of audio → 500" surfaces here as a non-ok status OR a missing
 * `audioContent`; both trigger the next attempt / model (TTS-ENGINE-3).
 * Returns base64 MP3 + the model that produced it.
 */
// Cloud-platform-scoped ADC for Cloud TTS. The Gemini TTS models
// (gemini-2.5-flash-tts …) are served through Vertex AI, whose
// `aiplatform.endpoints.predict` is an IAM permission — an API key CANNOT
// carry it (proven 2026-06-12: `?key=` → 403 PERMISSION_DENIED on
// //aiplatform…, a cloud-platform Bearer token → 200 + audio). On the
// gen-2 runtime this function now uses, the metadata token IS
// cloud-platform-scoped (the gen-1 token wasn't — that's why the earlier
// Bearer attempt 401'd), and the runtime SA has aiplatform via
// roles/editor, so ADC just works. No per-request key; no secret needed.
const ttsAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function synthGeminiTTS(opts: {
  text: string;
  languageCode: string;
  voiceName: string;
  prompt?: string;
  models: readonly string[];
}): Promise<{ audioContent: string; model: string }> {
  const token = await ttsAuth.getAccessToken();
  if (!token) {
    throw new Error("Cloud TTS: failed to obtain a cloud-platform access token");
  }
  const url = CLOUD_TTS_SYNTH_URL;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  let lastErr: unknown = new Error("no TTS models attempted");
  for (const model of opts.models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const body = {
          input: {
            text: opts.text,
            ...(opts.prompt ? { prompt: opts.prompt } : {}),
          },
          voice: {
            languageCode: opts.languageCode,
            name: opts.voiceName,
            model_name: model,
          },
          audioConfig: { audioEncoding: "MP3" },
        };
        const ttsRes = await withTimeout(
          fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          }),
          25_000,
          "synthesizeSpeech.fetch",
        );
        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          throw new Error(`Cloud TTS ${ttsRes.status} [${model}]: ${errText.slice(0, 120)}`);
        }
        const json = (await ttsRes.json()) as { audioContent?: string };
        if (!json.audioContent) {
          // text-instead-of-audio (documented 200-with-no-audio path)
          throw new Error(`Cloud TTS returned no audioContent [${model}]`);
        }
        return { audioContent: json.audioContent, model };
      } catch (err) {
        lastErr = err;
        console.warn("[synthesizeSpeech] attempt failed:", (err as Error)?.message ?? err);
      }
    }
  }
  throw lastErr;
}

// GEN-2 (Cloud Run) runtime — REQUIRED for TTS auth: only the gen-2
// runtime SA gets a cloud-platform-scoped metadata token, which Cloud
// TTS→Vertex needs (see synthGeminiTTS). Migrating a same-named function
// from gen-1→gen-2 is not an in-place upgrade: BEFORE the first deploy,
// run `firebase functions:delete synthesizeSpeech --project <beta|prod>`,
// then `npm run deploy:<beta|prod>:functions`. No GEMINI_API_KEY secret —
// auth is now ADC, not the key. CORS + preflight handled by the v2 `cors`
// option (mirrors geminiStreamV2), so no manual setCors / OPTIONS branch.
export const synthesizeSpeech = onRequestV2(
  "synthesizeSpeech",
  {
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: ALLOWED_ORIGINS,
  },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    // Allow streaming response so the client can start playing as data arrives
    res.setHeader("X-Accel-Buffering", "no");

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyAuth(req as unknown as Request);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
      return;
    }

    if (!(await checkRateLimit(decodedToken.uid, res))) return; // LIMIT-1
    // LIMIT-3 — TTS is spend too; the same switch stops it.
    if (!(await isGeminiEnabled())) { respondGeminiDisabled(res); return; }

    const { text, languageCode, speechSpeed = 3, voiceGender, voiceName } = req.body as {
      text: string;
      languageCode: string;
      /** TTS speed 1-4 (TTS-SPEED-1), independent of difficulty; 3 = natural
       *  (default, no steering), 1-2 clearer, 4 fast/very-casual. */
      speechSpeed?: number;
      voiceGender?: string;
      /** TTS-VOICE-3: an explicit Gemini voice, chosen per SPEAKER by the
       *  client (TTS-VOICE-2). Honoured only if it is in the server's own
       *  allowlist; anything else silently falls back to `voiceGender`. */
      voiceName?: string;
    };

    if (!text || !languageCode) {
      res.status(400).json({ error: "Missing text or languageCode" });
      return;
    }

    try {
      // Pure request shaping (./ttsSynth): model order by surface, voice by
      // gender, speed pacing from the user's speechSpeed pref on EVERY surface
      // (TTS-ENGINE-2/4, TTS-SPEED-1), text clipped to the byte cap (TTS-EDGE-5).
      const input = ttsInputFor(text, speechSpeed);
      const { audioContent, model } = await synthGeminiTTS({
        text: input.text,
        prompt: input.prompt,
        languageCode,
        // TTS-VOICE-3: the speaker's voice when the client named a real one,
        // else the gendered default this has always used.
        voiceName: ttsVoiceFor(voiceName, voiceGender),
        models: ttsModelOrder(),
      });

      // Usage accounting, partitioned by the model that actually served
      // the request (TTS-ENGINE-7). Input tokens are estimated from text
      // length; audio-output tokens are DERIVED from the returned audio at
      // 25 tokens/second, because the synthesize endpoint returns no usage
      // metadata and audio output is essentially the whole TTS bill.
      // Recording 0 here (the previous behaviour) under-reported TTS by
      // ~270x. Fire-and-forget — never blocks the audio response.
      void recordTokenUsage(
        decodedToken.uid,
        "tts_synthesis",
        Math.ceil(input.text.length / 4),
        ttsAudioTokens(audioContent, input.text),
        { model },
      ).catch(() => {});

      // JSON contract: base64 audio + mime so the client builds the blob
      // with the right type (TTS-ENGINE-5).
      res.json({ audioContent, model, mimeType: "audio/mpeg" });
    } catch (err: any) {
      console.error("[synthesizeSpeech] TTS error:", err?.message ?? err);
      const timedOut = err?.message?.includes("timed out");
      res.status(timedOut ? 504 : 500).json({
        error: timedOut ? "TTS request timed out — please try again" : "TTS synthesis failed",
      });
    }
  });

export const listStandardVoices = functionsV1
  .runWith({ timeoutSeconds: 60, memory: "256MB", secrets: ["GEMINI_API_KEY"] })
  .https.onRequest(withSentryHttp("listStandardVoices", async (req: Request, res: Response) => {
    setCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    if (!(await enforceVersionFloor(req, res))) return; // OBS-VERSION-10

    try {
      await verifyAuth(req);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
      return;
    }

    const { nativeLanguageCode, practiceLanguageCode } = req.body as {
      nativeLanguageCode?: string;
      practiceLanguageCode?: string;
    };
    if (!nativeLanguageCode || !practiceLanguageCode) {
      res.status(400).json({ error: "Missing nativeLanguageCode or practiceLanguageCode" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "TTS voices unavailable" });
      return;
    }

    try {
      const voices = await listAllTTSVoices(apiKey);

      const nativeVoices = getStandardVoicesForLanguage(voices, nativeLanguageCode);
      const practiceVoices = getStandardVoicesForLanguage(voices, practiceLanguageCode);

      const nativeAvailability = {
        female: nativeVoices.some((v) => v.gender === "female"),
        male: nativeVoices.some((v) => v.gender === "male"),
        hasAny: nativeVoices.length > 0,
      };
      const practiceAvailability = {
        female: practiceVoices.some((v) => v.gender === "female"),
        male: practiceVoices.some((v) => v.gender === "male"),
        hasAny: practiceVoices.length > 0,
      };

      const options: Array<{ gender: VoiceGender; label: string; nativeVoiceName: string; practiceVoiceName: string }> = [];
      let usedFallbackForAtLeastOneOption = false;
      if (nativeVoices.length && practiceVoices.length) {
        for (const gender of ["female", "male"] as const) {
          const nativeVoiceName = selectVoiceName(nativeVoices, gender) ?? nativeVoices[0]?.voiceName;
          const practiceVoiceName = selectVoiceName(practiceVoices, gender) ?? practiceVoices[0]?.voiceName;
          if (nativeVoiceName && practiceVoiceName) {
            if (!(nativeAvailability[gender] && practiceAvailability[gender])) {
              usedFallbackForAtLeastOneOption = true;
            }
            options.push({
              gender,
              label: gender === "female" ? "Prefer Female" : "Prefer Male",
              nativeVoiceName,
              practiceVoiceName,
            });
          }
        }
      }

      res.json({
        nativeLanguageCode,
        practiceLanguageCode,
        options,
        nativeAvailability,
        practiceAvailability,
        usingFallback: usedFallbackForAtLeastOneOption,
      });
    } catch (err: any) {
      console.error("[listStandardVoices] failed:", err);
      res.status(500).json({ error: "Failed to list voices" });
    }
  }));
