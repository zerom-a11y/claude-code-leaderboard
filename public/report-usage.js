const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");

// 5초 hard timeout
const HARD_TIMEOUT = setTimeout(() => process.exit(0), 5000);
HARD_TIMEOUT.unref();

const CONFIG_DIR = path.join(os.homedir(), ".config", "socar-board");

// --- Buddy (Companion) Detection ---
function isBuddyActive() {
  try {
    const claudeJsonPath = path.join(os.homedir(), ".claude.json");
    if (!fs.existsSync(claudeJsonPath)) return false;
    const data = JSON.parse(fs.readFileSync(claudeJsonPath, "utf8"));
    if (data.companionMuted) return false;
    return !!(data.companion && data.companion.name);
  } catch { return false; }
}

// --- Session Cache ---
function getSessionCachePath() {
  return path.join(CONFIG_DIR, "session-cache.json");
}

function loadSessionCache() {
  try { return JSON.parse(fs.readFileSync(getSessionCachePath(), "utf8")); }
  catch { return {}; }
}

function saveSessionCache(cache) {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [key, val] of Object.entries(cache)) {
      if (val.ts && val.ts < cutoff) delete cache[key];
    }
    fs.writeFileSync(getSessionCachePath(), JSON.stringify(cache));
  } catch {}
}

// --- Local Queue ---
function getQueuePath() { return path.join(CONFIG_DIR, "queue.jsonl"); }

function enqueue(data) {
  try { fs.appendFileSync(getQueuePath(), data + "\n"); } catch {}
}

function drainQueue(apiUrl, token, maxItems) {
  try {
    const qPath = getQueuePath();
    if (!fs.existsSync(qPath)) return;
    const lines = fs.readFileSync(qPath, "utf8").split("\n").filter(Boolean);
    if (lines.length === 0) return;
    const toSend = lines.slice(0, maxItems);
    const remaining = lines.slice(maxItems);
    const results = new Array(toSend.length).fill(false);
    let done = 0;
    for (let i = 0; i < toSend.length; i++) {
      httpPost(apiUrl, token, toSend[i], 3000, (ok) => {
        results[i] = ok;
        done++;
        if (done === toSend.length) {
          try {
            const failed = toSend.filter((_, idx) => !results[idx]);
            const kept = [...failed, ...remaining];
            if (kept.length === 0) fs.unlinkSync(qPath);
            else fs.writeFileSync(qPath, kept.join("\n") + "\n");
          } catch {}
        }
      });
    }
  } catch {}
}

function httpPost(apiUrl, token, data, timeoutMs, callback) {
  try {
    const url = new URL(apiUrl + "/api/report");
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      timeout: timeoutMs,
    }, (res) => {
      res.on("data", () => {});
      res.on("end", () => callback(res.statusCode >= 200 && res.statusCode < 300));
    });
    req.on("timeout", () => { req.destroy(); callback(false); });
    req.on("error", () => callback(false));
    req.write(data);
    req.end();
  } catch { callback(false); }
}

// --- Self Update (하루 1회) ---
function selfUpdate(apiUrl) {
  try {
    const lastUpdateFile = path.join(CONFIG_DIR, ".last-update");
    const today = new Date().toISOString().slice(0, 10);
    const lastUpdate = fs.existsSync(lastUpdateFile) ? fs.readFileSync(lastUpdateFile, "utf8").trim() : "";
    if (lastUpdate === today) return;
    const url = new URL(apiUrl + "/report-usage.js");
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(url, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          if (res.statusCode === 200 && body.length > 100) {
            const selfPath = path.join(CONFIG_DIR, "report-usage.js");
            const current = fs.existsSync(selfPath) ? fs.readFileSync(selfPath, "utf8") : "";
            if (body.trim() !== current.trim()) fs.writeFileSync(selfPath, body);
          }
          fs.writeFileSync(lastUpdateFile, today);
        } catch {}
      });
    });
    req.setTimeout(3000, () => req.destroy());
    req.on("error", () => {});
  } catch {}
}

// --- Statusline Collector Bootstrap ---
function bootstrapStatusline(apiUrl) {
  try {
    const collectorPath = path.join(CONFIG_DIR, "statusline-collector.js");
    if (fs.existsSync(collectorPath)) return;

    // 1. statusline-collector.js 다운로드
    const url = new URL(apiUrl + "/statusline-collector.js");
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(url, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          if (res.statusCode === 200 && body.length > 50) {
            fs.writeFileSync(collectorPath, body);

            // 2. settings.json에 statusLine 등록
            const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
            if (fs.existsSync(settingsPath)) {
              const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
              const cmd = settings.statusLine && settings.statusLine.command;
              if (cmd && cmd.includes("socar-board")) return;
              // 기존 statusLine 백업
              const origFile = path.join(CONFIG_DIR, "original_statusline_cmd");
              if (cmd) fs.writeFileSync(origFile, cmd);
              settings.statusLine = { type: "command", command: "node " + collectorPath };
              fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            }
          }
        } catch {}
      });
    });
    req.setTimeout(3000, () => req.destroy());
    req.on("error", () => {});
  } catch {}
}

// --- Rate Limits ---
function readRateLimits() {
  try {
    const rlPath = path.join(CONFIG_DIR, "rate-limits.json");
    return JSON.parse(fs.readFileSync(rlPath, "utf8"));
  } catch { return null; }
}

// --- Main ---
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const transcriptPath = event.transcript_path;
    const sessionId = event.session_id;
    if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

    const token = fs.readFileSync(path.join(CONFIG_DIR, "token"), "utf8").trim();
    const apiUrl = fs.readFileSync(path.join(CONFIG_DIR, "api_url"), "utf8").trim();

    selfUpdate(apiUrl);
    bootstrapStatusline(apiUrl);
    drainQueue(apiUrl, token, 10);

    const lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant") continue;
        const usage = entry.message && entry.message.usage;
        if (usage) {
          totalInput += usage.input_tokens || 0;
          totalOutput += usage.output_tokens || 0;
          totalCacheWrite += usage.cache_creation_input_tokens || 0;
          totalCacheRead += usage.cache_read_input_tokens || 0;
        }
      } catch {}
    }

    const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;
    if (totalTokens === 0) process.exit(0);

    // Delta 계산
    const cache = loadSessionCache();
    const prev = (sessionId && cache[sessionId]) || { inp: 0, out: 0, cr: 0, cw: 0, n: 0 };
    const dI = Math.max(0, totalInput - prev.inp);
    const dO = Math.max(0, totalOutput - prev.out);
    const dCR = Math.max(0, totalCacheRead - prev.cr);
    const dCW = Math.max(0, totalCacheWrite - prev.cw);
    const dTotal = dI + dO + dCR + dCW;
    if (dTotal <= 0) process.exit(0);

    if (sessionId) {
      cache[sessionId] = { inp: totalInput, out: totalOutput, cr: totalCacheRead, cw: totalCacheWrite, n: prev.n + 1, ts: Date.now() };
      saveSessionCache(cache);
    }

    const submissionId = sessionId ? (prev.n > 0 ? sessionId + "_r" + prev.n : sessionId) : null;

    const buddy = isBuddyActive();

    const rateLimits = readRateLimits();

    const payload = {
      session_id: submissionId,
      input_tokens: dI,
      output_tokens: dO,
      cache_read_tokens: dCR,
      cache_write_tokens: dCW,
      buddy: buddy,
    };
    if (rateLimits) payload.rate_limits = rateLimits;

    const data = JSON.stringify(payload);

    enqueue(data);
    httpPost(apiUrl, token, data, 3000, (ok) => {
      if (ok) {
        try {
          const qPath = getQueuePath();
          const qLines = fs.readFileSync(qPath, "utf8").split("\n").filter(Boolean);
          const idx = qLines.lastIndexOf(data);
          if (idx >= 0) qLines.splice(idx, 1);
          if (qLines.length === 0) fs.unlinkSync(qPath);
          else fs.writeFileSync(qPath, qLines.join("\n") + "\n");
        } catch {}
      }
      process.exit(0);
    });
  } catch { process.exit(0); }
});
