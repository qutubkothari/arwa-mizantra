/* Generates the Arabic UI catalogue from system-authored source strings.
 * Business records are never read or submitted for translation. */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "apps/web/src/lib/arabic-catalogue.generated.json");
const cachePath = path.join(root, ".tmp/arabic-translation-cache.json");
const scanRoots = [path.join(root, "apps/web/src"), path.join(root, "apps/api/src")];
const allowedAttributes = new Set(["placeholder", "title", "aria-label", "alt", "label", "text", "eyebrow", "overline", "description", "helperText", "emptyText", "subtitle", "buttonText", "confirmText", "cancelText", "message", "headers", "tabs"]);
const ignoredAttributes = new Set(["className", "href", "src", "id", "name", "type", "value", "role", "data-testid"]);
const commonCodes = new Set(["OPEN", "CLOSED", "COMPLETED", "PENDING", "APPROVED", "REJECTED", "CANCELLED", "ACTIVE", "INACTIVE", "DRAFT", "POSTED", "FAILED", "READY", "BLOCKED"]);
const uiPropertyNames = new Set(["label", "title", "text", "eyebrow", "overline", "description", "message", "reason", "warning", "headline", "helperText", "placeholder", "emptyText", "question", "detail", "disclaimer", "recommended_action"]);
const uiCallPattern = /(?:setError|setMessage|setSuccess|setWarning|setNotice|setStatus|toast|alert|confirm|BadRequestException|NotFoundException|ForbiddenException|ConflictException|UnauthorizedException|Error)$/;

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", ".next", "dist"].includes(entry.name) ? [] : filesUnder(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

function normalized(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function looksHuman(value) {
  const text = normalized(value);
  if (text.length < 2 || text.length > 700 || !/[A-Za-z]/.test(text)) return false;
  if (/^(https?:|\/|\.\/|\.\.\/|@\/|[A-Za-z]:\\)/.test(text)) return false;
  if (/^[.#][A-Za-z0-9_-]+$/.test(text) || /^[a-z]+\/[a-z0-9.+-]+$/i.test(text)) return false;
  if (/^[A-Z0-9_./:-]+$/.test(text) && !commonCodes.has(text)) return false;
  if (/^[a-z][a-zA-Z0-9_]*$/.test(text) && text.length > 14) return false;
  if ((text.match(/\b(?:flex|grid|rounded|border|text-|bg-|px-|py-|mt-|mb-|gap-|hover:|sm:|md:|lg:|xl:)/g) || []).length >= 2) return false;
  if (/^[a-z0-9_-]+(?:\s+[a-z0-9_:[\]/.-]+){3,}$/.test(text) && /[-:[\]]/.test(text)) return false;
  if (text.includes("{") && text.includes(";") && /#[a-z-]+|:[a-z-]+/.test(text)) return false;
  return true;
}

function allowedUntranslated(value) {
  const text = normalized(value);
  return /^(?:Mizantra(?: ERP| Intelligence)?|SAK Solutions(?: - APIS)?|Excel|PDF|[A-Z0-9]{1,8}(?:\s*[/&·-]\s*[A-Z0-9]{1,8})*|[A-Z0-9_-]+\.(?:pdf|xlsx?|docx?|csv))$/.test(text) ||
    /^&(?:quot|times|gt|lt|amp);$/.test(text) ||
    /^\+?[0-9X ()-]+$/.test(text) ||
    /^(?:NotAllowedError|development|ar|en|en-in|ies|ncr|siv|srv_qc|blank_cutting|tenant_id)$/.test(text) ||
    /^[a-z_]+\.[a-z_]+$/.test(text) ||
    /^[^\s@]+@[^\s@]+(?:;\s*[^\s@]+@[^\s@]+)*$/.test(text) ||
    /^(?:%|·)\s*(?:LGD|CPI|EAC|PD|Rs\.|SPI|v)$/.test(text) ||
    /^(?:\(v|E-way:|ERP v2|EXW \/ FCA \/ FOB \/ CIF|EXW \/ FOB \/ CIF|HSN SAC|NEFT \/ RTGS|PO\.pdf|⌘K)$/.test(text) ||
    /^(?:<|BEGIN:VEVENT|HTTP |MRP |Mizantra ERP \||Q\{0\}|Rs\. \{0\}|SIV |addr-|\{0\}[\-/.@]|\{0\}T)/.test(text);
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : "";
}

function isUiString(node, sourceName) {
  let current = node.parent;
  for (let depth = 0; current && depth < 7; depth++, current = current.parent) {
    if (ts.isJsxAttribute(current)) return allowedAttributes.has(propertyName(current.name));
    if (ts.isJsxExpression(current)) {
      if (ts.isJsxAttribute(current.parent)) return allowedAttributes.has(propertyName(current.parent.name));
      return true;
    }
    if (ts.isJsxElement(current) || ts.isJsxFragment(current)) return true;
    if (ts.isCallExpression(current)) {
      const called = current.expression.getText();
      return uiCallPattern.test(called);
    }
    if (ts.isNewExpression(current)) {
      return uiCallPattern.test(current.expression.getText());
    }
    if (ts.isPropertyAssignment(current) && uiPropertyNames.has(propertyName(current.name))) return true;
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return false;
    if (ts.isStatement(current)) break;
  }
  return sourceName.includes("apps/web/src") && current && ts.isReturnStatement(current);
}

function extract() {
  const exact = new Map();
  const patterns = new Map();
  const record = (map, text, file, node) => {
    const key = normalized(text);
    if (!looksHuman(key)) return;
    const line = file.source.getLineAndCharacterOfPosition(node.getStart(file.source)).line + 1;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(`${path.relative(root, file.name).replaceAll("\\", "/")}:${line}`);
  };
  for (const name of scanRoots.flatMap(filesUnder)) {
    if (name.endsWith("arabic-catalogue.generated.ts") || name.endsWith("locale.tsx")) continue;
    const sourceText = fs.readFileSync(name, "utf8");
    const isWebSource = name.replaceAll("\\", "/").includes("apps/web/src");
    const source = ts.createSourceFile(name, sourceText, ts.ScriptTarget.Latest, true, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const file = { name, source };
    const visit = (node) => {
      if (ts.isJsxText(node)) record(exact, node.text, file, node);
      if (ts.isJsxAttribute(node)) {
        const attr = propertyName(node.name);
        if (node.initializer && ts.isStringLiteral(node.initializer) && allowedAttributes.has(attr)) record(exact, node.initializer.text, file, node);
        if (ignoredAttributes.has(attr)) return;
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent;
        const inImport = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
        const isPropertyKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node;
        const jsxAttr = ts.isJsxAttribute(parent);
        if (!inImport && !isPropertyKey && !jsxAttr && (isWebSource || isUiString(node, name.replaceAll("\\", "/")))) record(exact, node.text, file, node);
      }
      if (ts.isTemplateExpression(node)) {
        let template = node.head.text;
        node.templateSpans.forEach((span, index) => { template += `{${index}}${span.literal.text}`; });
        if (isWebSource || isUiString(node, name.replaceAll("\\", "/"))) record(patterns, template, file, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { exact, patterns };
}

function loadEnvKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = path.join(root, "apps/api/.env");
  const line = fs.readFileSync(envPath, "utf8").split(/\r?\n/).find((entry) => entry.startsWith("OPENAI_API_KEY="));
  return line ? line.slice("OPENAI_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "") : "";
}

async function translateBatch(apiKey, model, items, instruction = "Translate ERP software interface copy into concise, professional Modern Standard Arabic suitable for Egyptian businesses. Return one translation per id. Preserve {0} placeholders, document codes, abbreviations, numbers, currencies, product names, HTML entities and punctuation. Translate status words and ERP terminology consistently. Never explain or omit an item.") {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "system", content: instruction },
        { role: "user", content: JSON.stringify(items) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "arabic_ui_translations",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["translations"],
            properties: {
              translations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "ar"],
                  properties: {
                    id: { type: "integer" },
                    ar: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`OpenAI translation failed (${response.status}): ${body?.error?.message || "unknown error"}`);
  const outputText = body.output_text || (body.output || []).flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  return JSON.parse(outputText).translations;
}

async function translateWithRetry(apiKey, model, batch, instruction) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await translateBatch(apiKey, model, batch, instruction); }
    catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function main() {
  const { exact, patterns } = extract();
  if (process.argv.includes("--union") && fs.existsSync(outputPath)) {
    const previous = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    for (const source of Object.keys(previous.exact || {})) {
      if (!exact.has(source) && !patterns.has(source)) exact.set(source, true);
    }
    for (const entry of previous.patterns || []) {
      if (entry?.source && !exact.has(entry.source) && !patterns.has(entry.source)) {
        patterns.set(entry.source, true);
      }
    }
  }
  const sources = [...exact.keys(), ...patterns.keys()];
  console.log(`Arabic source audit: ${exact.size} exact strings, ${patterns.size} dynamic patterns.`);
  if (process.argv.includes("--sample")) console.log([...exact.keys()].slice(0, 250).join("\n---\n"));
  if (process.argv.includes("--extract-only") || process.argv.includes("--sample")) return;
  const apiKey = loadEnvKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is unavailable.");
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
  const model = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini";
  if (process.argv.includes("--polish")) {
    const polishItems = sources.filter((source) => {
      const target = cache[source] || "";
      return /[\u0600-\u06ff]/.test(target) && /[A-Za-z]{3,}/.test(target);
    });
    const polishBatches = [];
    for (let offset = 0; offset < polishItems.length; offset += 70) {
      polishBatches.push(polishItems.slice(offset, offset + 70).map((source, id) => ({ id, source, current_arabic: cache[source] })));
    }
    const polishInstruction = "Proofread each Egyptian ERP Arabic UI translation. Remove accidental hybrid or untranslated ordinary English words (for example mapproved, breached, draft, collected, mehr) and produce fluent professional Modern Standard Arabic. Latin text is allowed ONLY for placeholders; numbers; currencies; document codes; file extensions; product/brand names; and these standard abbreviations: ERP, CRM, BOM, MRP, APS, ATP, FIFO, COGS, GRN, SIV, SRV, UID, QC, NCR, CAPA, KPI, SLA, IFRS, IAS, ECL, VAT, GST, TDS, HRA, PF, ESI, PT, PO, PR, SO, RFQ, RMA, AMC, PDF, CSV, Excel, AED, EGP, INR, USD, URL, API, JWT, QR, PLC, OEE, WIP, EVM, CPI, SPI, EAC, VAC, SES, BOE, CHA, AWB, LR, PD, LGD. Preserve every {0} placeholder exactly. Return a corrected Arabic translation for every id, with no explanations.";
    for (let offset = 0; offset < polishBatches.length; offset += 4) {
      const wave = polishBatches.slice(offset, offset + 4);
      const results = await Promise.all(wave.map((batch) => translateWithRetry(apiKey, model, batch, polishInstruction)));
      results.forEach((translated, waveIndex) => {
        const batch = wave[waveIndex];
        for (const row of translated) {
          const source = batch.find((item) => item.id === row.id)?.source;
          const target = normalized(row.ar);
          const sourceTokens = source?.match(/\{\d+\}/g) || [];
          const targetTokens = target.match(/\{\d+\}/g) || [];
          if (source && target && sourceTokens.join("|") === targetTokens.join("|")) cache[source] = target;
        }
      });
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");
      console.log(`Polished ${Math.min((offset + wave.length) * 70, polishItems.length)} / ${polishItems.length}`);
    }
  }
  const missing = sources.filter((text) => !cache[text] || (cache[text] === text && !allowedUntranslated(text)));
  const batchSize = 80;
  const batches = [];
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    batches.push(missing.slice(offset, offset + batchSize).map((text, id) => ({ id, text })));
  }
  for (let offset = 0; offset < batches.length; offset += 4) {
    const wave = batches.slice(offset, offset + 4);
    const results = await Promise.all(wave.map((batch) => translateWithRetry(apiKey, model, batch)));
    results.forEach((translated, waveIndex) => {
      const batch = wave[waveIndex];
      for (const row of translated) {
        const source = batch.find((item) => item.id === row.id)?.text;
        const target = normalized(row.ar);
        const sourceTokens = source?.match(/\{\d+\}/g) || [];
        const targetTokens = target.match(/\{\d+\}/g) || [];
        if (source && target && sourceTokens.join("|") === targetTokens.join("|")) cache[source] = target;
      }
    });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");
    const completed = Math.min((offset + wave.length) * batchSize, missing.length);
    console.log(`Translated ${completed} / ${missing.length}`);
  }
  const exactOutput = Object.fromEntries([...exact.keys()].sort().map((text) => [text, cache[text] || text]));
  const patternOutput = [...patterns.keys()].sort().map((text) => ({ source: text, target: cache[text] || text }));
  fs.writeFileSync(outputPath, JSON.stringify({ exact: exactOutput, patterns: patternOutput, generated_at: new Date().toISOString(), source_count: sources.length }, null, 2) + "\n");
  const untranslated = sources.filter((text) => !cache[text] || (cache[text] === text && !allowedUntranslated(text)));
  console.log(`Generated ${path.relative(root, outputPath)}; untranslated=${untranslated.length}.`);
  if (untranslated.length) console.log(untranslated.join("\n---\n"));
  if (untranslated.length) process.exitCode = 2;
}

main().catch((error) => { console.error(error.message); process.exit(1); });
