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
import { execFile } from "node:child_process";

export const name = "dsh-study";
export const inject = ["webServer"];

const ROOT = "I:\\yuzhuanyong\\study";
const CONTROL = path.join(ROOT, "control.json");
const PROGRESS = path.join(ROOT, "progress.json");
const NOTES = path.join(ROOT, "notes");
const LOG = path.join(ROOT, "learn.log");
// learn.mjs 跑的时候会写这个：阶段、正在读哪篇、开始时间。跑完 20 秒后自己删掉。
const LIVE = path.join(ROOT, "live.json");
// 额度闸的阈值和开关都存在这里，learn.mjs 每一轮都重新读，改完下一轮就生效
const CONFIG = path.join(ROOT, "config.json");

// 真正的执行者是计划任务 YuWeiXi-Study（每 30 分钟跑一次 learn.mjs）。
// 开关只管 control.json 的话，任务被禁用了就永远不动 —— 所以这里跟着一起改。
const TASK_NAME = "YuWeiXi-Study";

function schtasks(args) {
  return new Promise((resolve) => {
    try {
      execFile("schtasks.exe", args, { windowsHide: true, timeout: 20000 }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

async function syncTask(enabled) {
  if (enabled) {
    // 先启用，再立刻跑一轮：这样"打开开关"当场就能看到动静
    await schtasks(["/Change", "/TN", TASK_NAME, "/ENABLE"]);
    await schtasks(["/Run", "/TN", TASK_NAME]);
  } else {
    await schtasks(["/Change", "/TN", TASK_NAME, "/DISABLE"]);
  }
}

const DEFAULTS = { enabled: true, stopAfterCurrent: false, updatedAt: null, updatedBy: "default" };

function readControl() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONTROL, "utf8").replace(/^\uFEFF/, "")) };
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
  const live = readJSON(LIVE, null);
  const liveAgeMs = live && live.at ? Date.now() - Date.parse(live.at) : null;
  // 15 分钟没更新的状态算过期（脚本被掐掉不会自己清）
  const liveStale = liveAgeMs === null || !(liveAgeMs >= 0 && liveAgeMs < 15 * 60 * 1000);
  const running = !!live && !liveStale && live.phase !== "done";
  const q = readJSON(CONFIG, {}).quota || {};
  const quota = {
    stopAtSessionPercent: q.stopAtSessionPercent ?? 80,
    stopAtWeeklyPercent: q.stopAtWeeklyPercent ?? 90,
    stopAtMonthlyPercent: q.stopAtMonthlyPercent ?? 92,
    sessionGuard: q.sessionGuard ?? true,
    weeklyGuard: q.weeklyGuard ?? true,
  };

  return {
    control,
    quota,
    todayRounds: todayRounds.length,
    lastRoundAt: progress.lastRoundAt,
    stoppedReason: progress.stoppedReason,
    lastLog,
    notes: recentNotes(5),
    live: live || null,
    running,
    liveAgeMs,
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
  const register = () => ctx.webServer.register({
    kind: "exact",
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
        const on = !cur.enabled;
        const next = writeControl({
          enabled: on,
          stopAfterCurrent: on ? false : cur.stopAfterCurrent,
          // 手动打开的这一轮跳过「间隔 90 分钟」；额度闸不跳过
          forceOnce: on ? true : cur.forceOnce,
          // 重新打开时把「上一轮收摊停的」痕迹清掉，免得旧原因一直挂在那儿
          stoppedBy: on ? null : cur.stoppedBy,
          stoppedAt: on ? null : cur.stoppedAt,
        }, "panel");
        await syncTask(on);
        return send(res, 200, { ok: true, ...status(), control: next });
      }
      // 立刻跑一轮（不看间隔，但看额度）
      if (action === "run") {
        writeControl({ enabled: true, forceOnce: true }, "panel");
        await syncTask(true);
        return send(res, 200, { ok: true, ...status() });
      }
      // 两个额度限制的开关（5 小时窗口 / 本周用量）
      if (action === "quota") {
        const cfg = readJSON(CONFIG, {}) || {};
        const q = { ...(cfg.quota || {}) };
        if (typeof body.sessionGuard === "boolean") q.sessionGuard = body.sessionGuard;
        if (typeof body.weeklyGuard === "boolean") q.weeklyGuard = body.weeklyGuard;
        cfg.quota = q;
        fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
        return send(res, 200, { ok: true, ...status() });
      }
      if (action === "stopAfter") {
        const cur = readControl();
        const next = writeControl({ stopAfterCurrent: !cur.stopAfterCurrent }, "panel");
        return send(res, 200, { ok: true, ...status(), control: next });
      }
      if (action === "enable") {
        writeControl({ enabled: true, stopAfterCurrent: false, forceOnce: true, stoppedBy: null, stoppedAt: null }, "panel");
        await syncTask(true);
        return send(res, 200, { ok: true, ...status() });
      }
      if (action === "disable") {
        writeControl({ enabled: false, stopAfterCurrent: false }, "panel");
        await syncTask(false);
        return send(res, 200, { ok: true, ...status() });
      }
      return send(res, 400, { ok: false, error: "不认识的 action：" + action });
    },
  });

  if (typeof ctx.effect === "function") {
    ctx.effect(register, "dsh-study: /api/study");
  } else {
    register();
  }
}
