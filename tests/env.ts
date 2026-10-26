// Test bootstrap. Imported FIRST by every test file: it runs before the src/
// modules are evaluated, so `llmConfigured` (a module-level const in
// src/lib/env.ts) is computed with these keys absent. Tests must never reach
// the network — they exercise the deterministic template engine only.
delete process.env.LLM_API_KEY;
delete process.env.LLM_MODEL;
delete process.env.OCR_API_KEY;
delete process.env.OCR_API_URL;
delete process.env.WHATSAPP_ACCESS_TOKEN;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;

export {};
