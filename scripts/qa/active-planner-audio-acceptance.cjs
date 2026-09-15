const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const fail = (message, detail) => {
  throw new Error(`${message}${detail === undefined ? "" : `\n${JSON.stringify(detail, null, 2)}`}`);
};

async function body(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function main() {
  if (!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE))
    fail(`Refusing non-Mizantra URL: ${BASE}`);
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const auth = await body(login);
  if (!login.ok || !auth?.accessToken) fail("Mizantra test login failed.", auth);
  const authorization = `Bearer ${auth.accessToken}`;

  const languageResponse = await fetch(`${BASE}/api/v1/active-planner/audio/languages`, {
    headers: { authorization },
  });
  const languages = await body(languageResponse);
  const codes = languages?.languages?.map((language) => language.code) || [];
  for (const code of ["en", "hi", "ta", "bn", "ur", "ar"])
    if (!codes.includes(code)) fail(`Missing audio language ${code}.`, languages);
  if (languages.recording_retained !== false) fail("Recording retention contract is missing.", languages);

  const speechResponse = await fetch(`${BASE}/api/v1/active-planner/audio/speech`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ text: "Create a purchase order for one hundred cartons.", language: "en" }),
  });
  if (!speechResponse.ok) fail("Spoken answer endpoint failed.", await body(speechResponse));
  if (speechResponse.headers.get("x-ai-generated-voice") !== "true")
    fail("AI voice disclosure header is missing.");
  const audio = await speechResponse.arrayBuffer();
  if (audio.byteLength < 1000) fail("Spoken answer audio is unexpectedly empty.", { bytes: audio.byteLength });

  const form = new FormData();
  form.append("language", "en");
  form.append("audio", new Blob([audio], { type: "audio/mpeg" }), "voice-check.mp3");
  const transcriptResponse = await fetch(`${BASE}/api/v1/active-planner/audio/transcribe`, {
    method: "POST",
    headers: { authorization },
    body: form,
  });
  const transcript = await body(transcriptResponse);
  if (!transcriptResponse.ok) fail("Voice transcription endpoint failed.", transcript);
  if (!/purchase order/i.test(String(transcript?.transcript || "")))
    fail("Voice round-trip did not preserve the ERP request.", transcript);
  if (transcript.retained !== false || transcript.next_step !== "REVIEW_TRANSCRIPT")
    fail("Voice review/retention safety contract failed.", transcript);

  console.log(JSON.stringify({
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    languages: codes.length,
    speech_bytes: audio.byteLength,
    transcript: transcript.transcript,
    recording_retained: transcript.retained,
    next_step: transcript.next_step,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
