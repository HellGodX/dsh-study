// dsh-study — 浏览器端
//
// 两处界面，共用同一套后端（/api/study）：
//   1) 右下角挂件（前台）：一只小鲸鱼，角标显示今天学了几轮，点开看最近读的，
//      气泡里直接有「开/停」「跑完这轮再停」两个按钮。
//   2) 设置 → 插件 → 自主学习：同样的两个开关，写得更啰嗦。
window.__ModuleLoader__.load({
	id: "dsh-study",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { useState, useEffect, useCallback } = react;
		const h = react.createElement;

		const API = "/api/study";
		const POLL_MS = 5000;
		const WIDGET_ID = "dsh-study-widget";
		const POS_KEY = "dsh-study:widget-pos";

		// 自绘小鲸鱼（不依赖外部图片）：墨蓝身子 + 一本小书
		const WHALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<ellipse cx="32" cy="40" rx="21" ry="13" fill="#2C4A8C"/>
<ellipse cx="32" cy="45" rx="16" ry="7" fill="#3B5FA8"/>
<path d="M14 30c6-10 14-14 23-13 6 .6 10 3 13 6-5 2-9 6-11 11-4-5-9-7-15-7-4 0-7 1-10 3z" fill="#22397A"/>
<circle cx="42" cy="34" r="2.2" fill="#fff"/>
<circle cx="42.4" cy="34.4" r="1" fill="#14171c"/>
<path d="M36 44c3 2 7 2 10 0" stroke="#E7EDFB" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<rect x="19" y="46" width="16" height="10" rx="2" fill="#E7EDFB"/>
<rect x="19" y="46" width="7" height="10" rx="2" fill="#B9C9EC"/>
<path d="M26 48v7" stroke="#7F93C0" stroke-width="1"/>
<path d="M30 18c3-6 9-8 13-6" stroke="#3B5FA8" stroke-width="2.4" fill="none" stroke-linecap="round"/>
</svg>`;
		const WHALE_SRC = "data:image/svg+xml;utf8," + encodeURIComponent(WHALE_SVG);

		const S = {
			wrap: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 2px", maxWidth: "620px" },
			row: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", padding: "12px 14px", border: "1px solid var(--dsw-border-default, rgba(127,127,127,.22))", borderRadius: "10px" },
			title: { fontSize: "14px", fontWeight: 600 },
			desc: { fontSize: "12px", lineHeight: 1.6, color: "var(--dsw-text-secondary, rgba(127,127,127,.9))", marginTop: "4px" },
			meta: { fontSize: "12px", lineHeight: 1.8, color: "var(--dsw-text-secondary, rgba(127,127,127,.9))" },
			mono: { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "11px", opacity: 0.85 },
		};

		async function getStudy() {
			const r = await fetch(API, { headers: { accept: "application/json" } });
			const j = await r.json();
			if (!j.ok) throw new Error(j.error || "读取失败");
			return j;
		}

		async function postStudy(action) {
			const r = await fetch(API, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action }),
			});
			const j = await r.json();
			if (!j.ok) throw new Error(j.error || "操作失败");
			return j;
		}

		// ---------------- 设置页：两个开关 ----------------
		function Switch(props) {
			return h("button", {
				type: "button",
				style: { width: "42px", height: "24px", borderRadius: "12px", border: "none", cursor: "pointer", flex: "0 0 auto", position: "relative", transition: "background .15s", background: props.on ? "var(--dsw-color-success, #2ea043)" : "var(--dsw-border-muted, rgba(127,127,127,.35))" },
				onClick: props.onClick,
				"aria-pressed": !!props.on,
				title: props.on ? "点一下关" : "点一下开",
			}, h("span", { style: { position: "absolute", top: "3px", left: props.on ? "21px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff", transition: "left .15s" } }));
		}

		function Row(props) {
			return h("div", { style: S.row },
				h("div", { style: { flex: "1 1 auto" } },
					h("div", { style: S.title }, props.title),
					props.desc ? h("div", { style: S.desc }, props.desc) : null),
				h(Switch, { on: props.on, onClick: props.onClick }));
		}

		function Panel() {
			const [data, setData] = useState(null);
			const [err, setErr] = useState("");
			const load = useCallback(async () => {
				try { setData(await getStudy()); setErr(""); } catch (e) { setErr(String(e.message || e)); }
			}, []);
			useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);
			const post = useCallback(async (a) => {
				try { setData(await postStudy(a)); setErr(""); } catch (e) { setErr(String(e.message || e)); }
			}, []);

			if (err) return h("div", { style: S.wrap }, h("div", { style: S.title }, "自主学习"), h("div", { style: S.desc }, "连不上宿主路由：" + err));
			if (!data) return h("div", { style: S.wrap }, h("div", { style: S.desc }, "读取中…"));
			const c = data.control || {};
			return h("div", { style: S.wrap },
				h(Row, {
					title: "自主学习总开关",
					desc: c.enabled ? "开着。每半小时一次，一天最多四轮；5 小时窗口到 80% 就不开新任务。" : "关着。后台不读素材，已排的计划到点也直接跳过。",
					on: !!c.enabled,
					onClick: () => post("toggle"),
				}),
				h(Row, {
					title: "跑完这一轮再停",
					desc: c.stopAfterCurrent ? "已挂上收摊标记：这一轮跑完就自动关掉总开关。" : "点一下挂上；当前没在跑就立刻生效。",
					on: !!c.stopAfterCurrent,
					onClick: () => post("stopAfter"),
				}),
				h("div", { style: S.meta },
					"今天已经学 " + (data.todayRounds || 0) + " 轮",
					data.maybeRunning ? "，刚刚还有动静" : "",
					data.stoppedReason ? h("div", null, "上次为什么停：" + data.stoppedReason) : null,
					data.lastLog ? h("div", { style: S.mono }, data.lastLog) : null),
				data.notes && data.notes.length
					? h("div", null, h("div", { style: S.title }, "最近读过"),
						data.notes.map((n, i) => h("div", { key: i, style: S.meta },
							"· " + ((n.title && n.title.head) || n.file),
							n.title && n.title.gist ? h("span", { style: S.mono }, "  " + n.title.gist) : null)))
					: h("div", { style: S.meta }, "还没读过东西。"));
		}

		// ---------------- 前台挂件 ----------------
		function el(tag, css, text) {
			const n = document.createElement(tag);
			if (css) n.style.cssText = css;
			if (text != null) n.textContent = text;
			return n;
		}

		function readPos() {
			try { const p = JSON.parse(window.localStorage.getItem(POS_KEY) || "null"); if (p && typeof p.right === "number") return p; } catch {}
			return null;
		}

		function mountWidget() {
			if (typeof document === "undefined" || !document.body) return;
			if (document.getElementById(WIDGET_ID)) return;

			const pos = readPos() || { right: 96, bottom: 24 };
			const root = el("div", "position:fixed;right:" + pos.right + "px;bottom:" + pos.bottom + "px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;user-select:none;font-family:inherit;");
			root.id = WIDGET_ID;

			const bubble = el("div", "display:none;position:relative;width:214px;padding:10px 12px;border-radius:14px;background:var(--dsw-surface-1,rgba(28,28,30,.92));color:var(--dsw-text-primary,inherit);border:1px solid var(--dsw-border-default,rgba(127,127,127,.28));box-shadow:0 10px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px);font-size:11px;line-height:1.5;cursor:default;");

			const title = el("div", "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;");
			title.appendChild(el("span", "font-size:11px;font-weight:600;letter-spacing:.02em;", "自主学习"));
			const dot = el("span", "font-size:10px;", "●");
			title.appendChild(dot);
			bubble.appendChild(title);

			const body = el("div", "");
			bubble.appendChild(body);

			const btns = el("div", "display:flex;gap:6px;margin-top:8px;");
			const bMain = el("button", "flex:1;padding:5px 0;border-radius:8px;border:1px solid var(--dsw-border-default,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:10px;cursor:pointer;", "开");
			const bAfter = el("button", "flex:1;padding:5px 0;border-radius:8px;border:1px solid var(--dsw-border-default,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:10px;cursor:pointer;", "跑完再停");
			btns.appendChild(bMain); btns.appendChild(bAfter);
			bubble.appendChild(btns);

			const foot = el("div", "margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-border-muted,rgba(127,127,127,.18));font-size:10px;opacity:.5;", "");
			bubble.appendChild(foot);

			const tail = el("div", "position:absolute;right:16px;bottom:-6px;width:12px;height:12px;background:var(--dsw-surface-1,rgba(28,28,30,.92));border-right:1px solid var(--dsw-border-default,rgba(127,127,127,.28));border-bottom:1px solid var(--dsw-border-default,rgba(127,127,127,.28));transform:rotate(45deg);");
			bubble.appendChild(tail);

			const avatar = el("div", "width:64px;height:64px;cursor:pointer;position:relative;transition:transform .18s ease,opacity .2s;filter:drop-shadow(0 8px 16px rgba(18,44,100,.32));");
			const img = document.createElement("img");
			img.src = WHALE_SRC;
			img.alt = "自主学习";
			img.draggable = false;
			img.style.cssText = "width:100%;height:100%;display:block;pointer-events:none;user-select:none;-webkit-user-drag:none;";
			avatar.appendChild(img);

			const badge = el("span", "position:absolute;right:-4px;top:-4px;min-width:20px;height:16px;padding:0 4px;border-radius:8px;background:var(--dsw-surface-1,#1c1c1e);color:var(--dsw-text-primary,#fff);border:1px solid var(--dsw-border-default,rgba(127,127,127,.3));font-size:9px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums;", "");
			avatar.appendChild(badge);

			root.appendChild(bubble);
			root.appendChild(avatar);

			let open = false;
			let last = null;
			let errMsg = "";

			function applyOff() {
				const off = !(last && last.control && last.control.enabled);
				avatar.style.opacity = off ? "0.55" : "1";
			}

			function paint() {
				body.textContent = "";
				if (errMsg) {
					dot.style.color = "var(--dsw-color-danger,#f85149)";
					body.appendChild(el("div", "color:var(--dsw-color-danger,#f85149);font-size:10px;", errMsg));
					return;
				}
				const c = (last && last.control) || {};
				dot.style.color = c.enabled ? "var(--dsw-color-success,#2ea043)" : "rgba(127,127,127,.6)";
				body.appendChild(el("div", "margin:2px 0 6px;opacity:.8;", c.enabled ? "在学。" : "停了。"));
				body.appendChild(el("div", "opacity:.62;font-size:10px;", "今天 " + ((last && last.todayRounds) || 0) + " 轮"));
				if (c.stopAfterCurrent) body.appendChild(el("div", "opacity:.62;font-size:10px;color:var(--dsw-color-warning,#d29922);", "收摊标记已挂"));
				const notes = (last && last.notes) || [];
				if (notes.length) {
					body.appendChild(el("div", "margin-top:6px;opacity:.5;font-size:10px;", "最近读过"));
					for (const n of notes.slice(0, 3)) {
						const t = (n.title && n.title.head) || n.file;
						body.appendChild(el("div", "opacity:.72;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", "· " + t));
					}
				}
				bMain.textContent = c.enabled ? "停" : "开";
				bAfter.style.opacity = c.stopAfterCurrent ? "0.55" : "1";
				bAfter.textContent = c.stopAfterCurrent ? "已挂收摊" : "跑完再停";
				foot.textContent = c.enabled ? "点鲸鱼收起" : "关着的时候不烧额度";
				applyOff();
			}

			async function load() {
				try {
					last = await getStudy();
					errMsg = "";
					const n = last.todayRounds || 0;
					badge.textContent = String(n);
					badge.style.opacity = n > 0 ? "1" : "0";
					if (open) paint(); else applyOff();
				} catch (e) {
					errMsg = String(e.message || e);
					if (open) paint();
				}
			}

			function toggle() {
				open = !open;
				bubble.style.display = open ? "block" : "none";
				if (open) paint();
			}

			avatar.addEventListener("click", () => {
				if (moved) { moved = false; return; }
				toggle();
			});
			avatar.addEventListener("mouseenter", () => { avatar.style.transform = "translateY(-1px) scale(1.04)"; });
			avatar.addEventListener("mouseleave", () => { avatar.style.transform = ""; });

			bMain.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				try { last = await postStudy("toggle"); errMsg = ""; paint(); load(); } catch (e) { errMsg = String(e.message || e); paint(); }
			});
			bAfter.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				try { last = await postStudy("stopAfter"); errMsg = ""; paint(); load(); } catch (e) { errMsg = String(e.message || e); paint(); }
			});

			let dragging = false, moved = false, sx = 0, sy = 0, sr = 0, sb = 0;
			avatar.addEventListener("pointerdown", (ev) => {
				if (ev.button !== 0) return;
				dragging = true; moved = false;
				sx = ev.clientX; sy = ev.clientY;
				sr = parseFloat(root.style.right) || pos.right;
				sb = parseFloat(root.style.bottom) || pos.bottom;
				avatar.setPointerCapture && avatar.setPointerCapture(ev.pointerId);
			});
			window.addEventListener("pointermove", (ev) => {
				if (!dragging) return;
				const dx = ev.clientX - sx, dy = ev.clientY - sy;
				if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
				if (!moved) return;
				const right = Math.max(6, Math.min(window.innerWidth - 70, sr - dx));
				const bottom = Math.max(6, Math.min(window.innerHeight - 70, sb - dy));
				root.style.right = right + "px";
				root.style.bottom = bottom + "px";
			});
			window.addEventListener("pointerup", () => {
				if (!dragging) return;
				dragging = false;
				if (moved) {
					try { window.localStorage.setItem(POS_KEY, JSON.stringify({ right: parseFloat(root.style.right) || pos.right, bottom: parseFloat(root.style.bottom) || pos.bottom })); } catch {}
					setTimeout(() => { moved = false; }, 0);
				}
			});

			document.body.appendChild(root);
			window.__dshStudyWidget = { root, load, toggle };
			load();
			setInterval(load, POLL_MS);
		}

		function ensureMount(tries) {
			if (typeof document === "undefined") return;
			if (document.getElementById(WIDGET_ID)) return;
			if (!document.body) {
				if (tries > 0) setTimeout(() => ensureMount(tries - 1), 400);
				return;
			}
			mountWidget();
		}

		function apply(ctx) {
			ctx.slots.inject("plugins.bundle.config", function () {
				return ctx.slots.register({ name: "plugins.bundle.config", key: "dsh-study" }, function () {
					return h(Panel, null);
				});
			});
			ensureMount(40);
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.__internals = { mountWidget, ensureMount, WHALE_SRC };
		return module.exports;
	},
});
