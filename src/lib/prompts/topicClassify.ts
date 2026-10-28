/**
 * SRV-PROMPT-1 / TOPIC-SET-5 — what is left of the client's topic-classify
 * prompt: one wire constant.
 *
 * The system instruction, the user prompt and the response schema all live in
 * `functions/src/prompts/topicClassify.ts` and are built there from a
 * `promptSpec` carrying the live theme set (`themes: [{ name, description }]`,
 * TOPIC-SET-4/7). A native build freezes its JS (`webDir: 'dist'`, no
 * `server.url`), so a prompt in the bundle could only be corrected by an App
 * Store review; in `functions/` it is a `deploy:prod:functions` away.
 *
 * The classifier picks one of the themes or `other`; it never mints a topic
 * (TOPIC-SET-5), so there is no new-topic sentinel any more. `other` is the
 * escape theme: a real `/topics` doc the client never lists to the model (the
 * server adds it to the response enum itself) but must accept in the response.
 * Its twin lives in the server module; both sides must agree on the string.
 */
export const OTHER_TOPIC = 'other';
