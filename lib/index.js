/**
 * dsh-study — host half.
 *
 * 后台自学任务（I:\yuzhuanyong\study\learn.mjs）原来的开关是改 JSON、改计划任务，
 * 太笨。这里给一条本机路由，让设置页能点：
 *
 *   GET  /api/study          当前开关、今日轮次、最近笔记、额度
 *   POST /api/study          { action: "toggle" | "stopAfter" | "runNow" }
 *
 * 真正的开关落在一个文件上：I:\yuzhuanyong\study\control.json
 * learn.mjs 每轮开头读它，跑完再看一眼 stopAfterCurrent。
 * 这样做的好处是：面板挂了、DSH 没开，自学脚本照样认这个开关。
 */
import fs from "node:fs";
import path from "node:path";

export const name = "dsh-study";
export const inject = ["webServer"];

const ROOT = "I:\\yuzhuanyong\\study";
const CONTROL = path.join(ROOT, "control.json");
const PROGRESS = path.join(ROOT, "progress.json");
const NOTES = path.join(ROOT, "notes");
const LOG = path.join(ROOT, "learn.log");

const DEFAULTS = { enabled: true, stopAfterCurrent: false, updatedAt: null, updatedBy: "default" };

function readControl() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONTROL, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeControl(patch, by) {
  const next = { ...readControl(), ...patch, updatedAt: new Date().toISOString(), updatedBy: by || "panel" };
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(CONTROL, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function recentNotes(limit = 5) {
  try {
    return fs.readdirSync(NOTES)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ file: f, at: fs.statSync(path.join(NOTES, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map((x) => ({
        file: x.file,
        at: new Date(x.at).toISOString(),
        // 标题取第一行（去掉 #），摘要取"观察："那一段
        title: (() => {
          try {
            const t = fs.readFileSync(path.join(NOTES, x.file), "utf8");
            const h = (t.match(/^#\s+(.+)$/m) || [])[1] || x.file;
            const ob = (t.match(/^观察[:：]\s*(.+)$/m) || [])[1] || "";
            return { head: h, gist: ob.slice(0, 80) };
          } catch { return { head: x.file, gist: "" }; }
        })(),
      }));
  } catch { return []; }
}

function status() {
  const control = readControl();
  const progress = readJSON(PROGRESS, { rounds: [], lastRoundAt: null, stoppedReason: null });
  const today = new Date().toISOString().slice(0, 10);
  const todayRounds = (progress.rounds || []).filter((r) => (r.at || "").slice(0, 10) === today);
  let lastLog = "";
  try {
    const lines = fs.readFileSync(LOG, "utf8").trim().split("\n");
    lastLog = lines[lines.length - 1] || "";
  } catch {}
  return {
    control,
    todayRounds: todayRounds.length,
    lastRoundAt: progress.lastRoundAt,
    stoppedReason: progress.stoppedReason,
    lastLog,
    notes: recentNotes(5),
    // 「正在跑」没有可靠的进程信号，用最近一次日志时间近似
    maybeRunning: (() => {
      try { return Date.now() - fs.statSync(LOG).mtimeMs < 120000; } catch { return false; }
    })(),
  };
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isLocal(req) {
  const a = req.socket && req.socket.remoteAddress;
  return !a || a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.route({
    path: "/api/study",
    handler: async (req, res) => {
      if (!isLocal(req)) return send(res, 403, { ok: false, error: "只允许本机访问" });

      if ((req.method || "GET").toUpperCase() === "GET") {
        return send(res, 200, { ok: true, ...status() });
      }
      if ((req.method || "GET").toUpperCase() !== "POST") {
        return send(res, 405, { ok: false, error: "只支持 GET / POST" });
      }

      const body = await readBody(req);
      const action = String(body.action || "");
      if (action === "toggle") {
        const cur = readControl();
        const next = writeControl({ enabled: !cur.enabled, stopAfterCurrent: !cur.enabled ? false : cur.stopAfterCurrent }, "panel");
        return send(res, 200, { ok: true, ...status(), control: next });
      }
      if (action === "stopAfter") {
        const cur = readControl();
        const next = writeControl({ stopAfterCurrent: !cur.stopAfterCurrent }, "panel");
        return send(res, 200, { ok: true, ...status(), control: next });
      }
      if (action === "enable") {
        writeControl({ enabled: true, stopAfterCurrent: false }, "panel");
        return send(res, 200, { ok: true, ...status() });
      }
      if (action === "disable") {
        writeControl({ enabled: false, stopAfterCurrent: false }, "panel");
        return send(res, 200, { ok: true, ...status() });
      }
      return send(res, 400, { ok: false, error: "不认识的 action：" + action });
    },
  }), "dsh-study: /api/study");
}
