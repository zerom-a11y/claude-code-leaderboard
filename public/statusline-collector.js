const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// 5초 hard timeout
const HARD_TIMEOUT = setTimeout(() => process.exit(0), 5000);
HARD_TIMEOUT.unref();

const CONFIG_DIR = path.join(os.homedir(), ".config", "socar-board");
const RATE_LIMITS_FILE = path.join(CONFIG_DIR, "rate-limits.json");
const ORIGINAL_CMD_FILE = path.join(CONFIG_DIR, "original_statusline_cmd");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  // 1. rate_limits 추출 및 저장
  try {
    const data = JSON.parse(input);
    if (data.rate_limits) {
      fs.writeFileSync(RATE_LIMITS_FILE, JSON.stringify(data.rate_limits));
    }
  } catch {}

  // 2. 원본 statusLine command가 있으면 pass-through
  try {
    if (fs.existsSync(ORIGINAL_CMD_FILE)) {
      const cmd = fs.readFileSync(ORIGINAL_CMD_FILE, "utf8").trim();
      if (cmd) {
        const shell = process.platform === "win32" ? "cmd" : "sh";
        const shellArg = process.platform === "win32" ? "/c" : "-c";
        const child = spawn(shell, [shellArg, cmd], {
          stdio: ["pipe", "inherit", "inherit"],
        });
        child.stdin.write(input);
        child.stdin.end();
        child.on("close", (code) => process.exit(code || 0));
        child.on("error", () => process.exit(0));
        return;
      }
    }
  } catch {}
  process.exit(0);
});
