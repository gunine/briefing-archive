// 대시보드 (정량·정성 분석) — 정적. app.js 뒤에 로드되어 allBriefings/activeCompetitor/renderCards 를 공유한다.
// 색상은 검증 완료(화이트 서피스): 상 #C00000 / 중 #2E75B6 / 하 #8792A2 (L밴드·CVD ΔE30.4·콘트라스트 PASS,
// '하'의 무채색은 상태 스케일의 의도적 de-emphasis — 범례·2px 갭·툴팁·표 뷰가 완화 채널).
// 단일 시리즈 네이비 #1F3864 (11.6:1), 히트맵 램프는 단조 명도(라이트: 진할수록 많음).

const VIZ = {
  high: "#c00000",
  medium: "#2e75b6",
  low: "#8792a2",
  blue: "#1f3864", // 단일 시리즈(키워드/출처)는 브랜드 네이비
  ramp: ["#d9e5f2", "#a9c6e3", "#6fa0d0", "#2e75b6", "#1f3864"],
  grid: "#e3e6eb",
  muted: "#5a6472",
  ink: "#1a2233",
};
const IMP_ORDER = ["high", "medium", "low"];
const IMP_LABEL = { high: "상", medium: "중", low: "하" };

const dashEl = document.getElementById("dashboard");
const tooltipEl = document.getElementById("viz-tooltip");
const cardsEl = document.getElementById("cards");
const impFilterEl = document.getElementById("filters");
const emptyEl = document.getElementById("empty");

let briefingsFull = [];
let dashLoaded = false;

// ── DOM 헬퍼 (데이터는 전부 textContent 로 — innerHTML 금지) ──
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svg(tag, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
// 위/오른쪽만 둥근 사각형 path (데이터 끝 4px 라운드, 베이스라인은 직각)
function roundTopRect(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt} Z`;
}
function roundRightRect(x, y, w, hgt, r) {
  r = Math.min(r, hgt / 2, w);
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt - r} Q${x + w},${y + hgt} ${x + w - r},${y + hgt} H${x} Z`;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}
// CJK(전각)=2유닛, 그 외=1유닛 근사 폭으로 라벨 절단 — 전체 이름은 툴팁·표 뷰에 남는다
function truncLabel(str, maxUnits) {
  let u = 0;
  for (let i = 0; i < str.length; i++) {
    u += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿＀-｠]/.test(str[i]) ? 2 : 1;
    if (u > maxUnits) return str.slice(0, Math.max(1, i)) + "…";
  }
  return str;
}

// ── 툴팁 (하나를 공유, 값이 주인공·라벨은 보조) ──
function showTooltip(evt, title, rows) {
  tooltipEl.textContent = "";
  tooltipEl.appendChild(h("div", "tt-title", title));
  for (const r of rows) {
    const row = h("div", "tt-row");
    if (r.color) {
      const key = h("span", "tt-key");
      key.style.background = r.color;
      row.appendChild(key);
    }
    row.appendChild(h("span", "tt-val", r.value));
    row.appendChild(h("span", "tt-label", r.label));
    tooltipEl.appendChild(row);
  }
  tooltipEl.hidden = false;
  positionTooltip(evt);
}
function positionTooltip(evt) {
  const pad = 12;
  const { innerWidth: vw, innerHeight: vh } = window;
  const rect = tooltipEl.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + rect.width > vw - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > vh - 8) y = evt.clientY - rect.height - pad;
  tooltipEl.style.left = `${Math.max(8, x)}px`;
  tooltipEl.style.top = `${Math.max(8, y)}px`;
}
function hideTooltip() { tooltipEl.hidden = true; }
function bindTip(node, getTitleRows) {
  node.addEventListener("pointerenter", (e) => { const [t, r] = getTitleRows(); showTooltip(e, t, r); });
  node.addEventListener("pointermove", positionTooltip);
  node.addEventListener("pointerleave", hideTooltip);
  node.setAttribute("tabindex", "0");
  node.addEventListener("focus", () => {
    const b = node.getBoundingClientRect();
    const [t, r] = getTitleRows();
    showTooltip({ clientX: b.left + b.width / 2, clientY: b.top }, t, r);
  });
  node.addEventListener("blur", hideTooltip);
}

// ── 데이터 적재/스코프 ──
let loadedKey = null; // 어떤 인덱스(id 목록) 기준으로 로드했는지 — 바뀌면 다시 로드
let loadFailures = 0; // 이번 적재에서 불러오지 못한 브리핑 수 (사용자에게 알린다)
async function ensureDashData() {
  const ids = allBriefings.map((b) => b.id);
  const key = ids.join(",");
  if (dashLoaded && key === loadedKey) return;
  const loaded = await Promise.all(ids.map(async (id) => {
    try {
      const res = await fetch(`data/briefings/${id}.json`);
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }));
  const ok = loaded.filter(Boolean);
  loadFailures = ids.length - ok.length;
  briefingsFull = ok.sort((a, b) => a.date.localeCompare(b.date));
  loadedKey = key;
  // 일부 fetch 실패 시 캐시를 확정하지 않아 다음 렌더에서 재시도된다
  dashLoaded = ok.length === ids.length;
}

// 경쟁사 필터가 대시보드 전체를 스코프한다.
// 브리핑 포함 기준은 카드 뷰(renderCards)와 동일하게 등록된 competitors 배열만 사용 — 두 뷰의 수치가 일치해야 한다.
function scoped() {
  const briefs = briefingsFull.filter((b) =>
    activeCompetitor === "all" || (b.competitors || []).includes(activeCompetitor));
  const items = briefs.flatMap((b) =>
    (b.items || []).map((it) => ({ ...it, briefDate: b.date })))
    .filter((it) => activeCompetitor === "all" || it.competitor === activeCompetitor);
  return { briefs, items };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function countBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function impCounts(items) {
  const c = { high: 0, medium: 0, low: 0 };
  items.forEach((it) => { if (c[it.importance] !== undefined) c[it.importance]++; });
  return c;
}

// ── 카드 골격 ──
function chartCard(title, note) {
  const card = h("div", "dash-card");
  const head = h("div", "dash-head");
  head.appendChild(h("h2", "dash-title", title));
  const toggle = h("button", "tbl-toggle", "표");
  toggle.type = "button";
  head.appendChild(toggle);
  card.appendChild(head);
  if (note) card.appendChild(h("p", "dash-note", note));
  const chartBody = h("div", "chart-body");
  const tableBody = h("div", "table-body");
  tableBody.hidden = true;
  card.appendChild(chartBody);
  card.appendChild(tableBody);
  toggle.addEventListener("click", () => {
    const showTable = tableBody.hidden;
    tableBody.hidden = !showTable;
    chartBody.hidden = showTable;
    toggle.textContent = showTable ? "차트" : "표";
  });
  return { card, chartBody, tableBody, toggle };
}
// 데이터 없는 카드: 메시지 표시 + 표 토글 비활성(빈 표로 전환되는 것 방지)
function markEmpty(parts, msg = "데이터 없음") {
  parts.chartBody.appendChild(h("p", "dash-empty", msg));
  parts.toggle.hidden = true;
}
function impLegend() {
  const lg = h("div", "viz-legend");
  for (const imp of IMP_ORDER) {
    const item = h("span", "lg-item");
    const sw = h("span", "lg-swatch");
    sw.style.background = VIZ[imp];
    item.appendChild(sw);
    item.appendChild(h("span", null, IMP_LABEL[imp]));
    lg.appendChild(item);
  }
  return lg;
}
function dataTable(headers, rows) {
  const tbl = h("table", "viz-table");
  const thead = h("thead"); const trh = h("tr");
  headers.forEach((hd) => trh.appendChild(h("th", null, hd)));
  thead.appendChild(trh); tbl.appendChild(thead);
  const tbody = h("tbody");
  rows.forEach((r) => {
    const tr = h("tr");
    r.forEach((cell, i) => tr.appendChild(h("td", i > 0 ? "num" : null, String(cell))));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return tbl;
}

// ── KPI 행 (헤드라인 숫자는 차트가 아니라 스탯 타일) ──
function renderKpis(container, briefs, items) {
  const row = h("div", "kpi-row");
  const c = impCounts(items);
  const comps = new Set(items.map((it) => it.competitor).filter(Boolean));
  const tiles = [
    { label: "브리핑", value: briefs.length },
    { label: "수집 항목", value: items.length },
    { label: "중요도 상", value: c.high, sub: items.length ? `${Math.round((c.high / items.length) * 100)}%` : "" },
    { label: "경쟁사", value: comps.size },
  ];
  for (const t of tiles) {
    const tile = h("div", "kpi-tile");
    tile.appendChild(h("div", "kpi-label", t.label));
    const v = h("div", "kpi-value", String(t.value));
    tile.appendChild(v);
    if (t.sub) tile.appendChild(h("div", "kpi-sub", t.sub));
    row.appendChild(tile);
  }
  container.appendChild(row);
}

// ── 차트 1: 날짜별 항목 추이 (중요도 스택 컬럼) ──
function renderTrend(container, items) {
  const parts = chartCard("날짜별 수집 항목", null);
  const { card, chartBody, tableBody } = parts;
  card.insertBefore(impLegend(), chartBody);

  const byDate = new Map();
  for (const it of items) {
    if (!byDate.has(it.briefDate)) byDate.set(it.briefDate, { high: 0, medium: 0, low: 0 });
    const d = byDate.get(it.briefDate);
    if (d[it.importance] !== undefined) d[it.importance]++;
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) { markEmpty(parts); container.appendChild(card); return; }

  const W = 640, PH = 180, PADL = 34, PADB = 26, PADT = 12;
  const H = PH + PADB + PADT;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "viz-svg", role: "img" });
  const maxTotal = niceMax(Math.max(...dates.map((d) => { const c = byDate.get(d); return c.high + c.medium + c.low; })));
  const yScale = (v) => PADT + PH - (v / maxTotal) * PH;

  // 가는 수평 그리드 + 눈금 (해어라인, recessive) — 건수 축이므로 정수만
  const mid = Math.round(maxTotal / 2);
  const ticks = mid > 0 && mid < maxTotal ? [0, mid, maxTotal] : [0, maxTotal];
  for (const t of ticks) {
    root.appendChild(svg("line", { x1: PADL, x2: W - 8, y1: yScale(t), y2: yScale(t), stroke: VIZ.grid, "stroke-width": 1 }));
    const lbl = svg("text", { x: PADL - 6, y: yScale(t) + 4, "text-anchor": "end", class: "viz-axis" });
    lbl.textContent = String(t);
    root.appendChild(lbl);
  }

  const band = (W - PADL - 16) / dates.length;
  const barW = Math.min(24, band * 0.5);
  const labelStep = Math.max(1, Math.ceil(dates.length / 8)); // 라벨 충돌 방지 — 최대 ~8개만
  dates.forEach((date, i) => {
    const cx = PADL + band * i + band / 2;
    const c = byDate.get(date);
    let yCursor = PADT + PH;
    const segs = IMP_ORDER.filter((imp) => c[imp] > 0);
    segs.slice().reverse().forEach((imp, idx, arr) => {
      // 아래(하)부터 위(상)로 쌓기 — reverse 순회로 low 가 바닥
      const span = (c[imp] / maxTotal) * PH;
      const yTop = yCursor - span;
      const isTopmost = idx === arr.length - 1;
      // 2px 서피스 갭은 세그먼트 '위쪽'에 — 베이스라인은 항상 직각으로 닿는다
      const mark = isTopmost
        ? svg("path", { d: roundTopRect(cx - barW / 2, yTop, barW, span, 4), fill: VIZ[imp] })
        : svg("rect", { x: cx - barW / 2, y: yTop + 2, width: barW, height: Math.max(1, span - 2), fill: VIZ[imp] });
      root.appendChild(mark);
      yCursor = yTop;
    });
    // x 라벨 (MM-DD) — 솎아서 표시
    if (i % labelStep === 0) {
      const xl = svg("text", { x: cx, y: PADT + PH + 16, "text-anchor": "middle", class: "viz-axis" });
      xl.textContent = date.slice(5);
      root.appendChild(xl);
    }
    // 히트 타깃 (마크보다 크게)
    const hit = svg("rect", { x: PADL + band * i, y: PADT, width: band, height: PH + PADB, fill: "transparent" });
    bindTip(hit, () => [date, IMP_ORDER.map((imp) => ({ label: IMP_LABEL[imp], value: String(c[imp]), color: VIZ[imp] }))]);
    root.appendChild(hit);
  });
  chartBody.appendChild(root);

  tableBody.appendChild(dataTable(["날짜", "상", "중", "하", "계"],
    dates.map((d) => { const c = byDate.get(d); return [d, c.high, c.medium, c.low, c.high + c.medium + c.low]; })));
  container.appendChild(card);
}

// ── 차트 2: 경쟁사별 항목 (수평 스택 바) ──
function renderByCompetitor(container, items) {
  const rowsAll = countBy(items, (it) => it.competitor).map(([name]) => {
    const its = items.filter((it) => it.competitor === name);
    return { name, ...impCounts(its), total: its.length };
  });
  const rows = rowsAll.slice(0, 8);
  const note = rowsAll.length > 8 ? `상위 8개 표시 (외 ${rowsAll.length - 8}개는 표에서)` : null;
  const parts = chartCard("경쟁사별 항목", note);
  const { card, chartBody, tableBody } = parts;
  card.insertBefore(impLegend(), chartBody);
  if (!rows.length) { markEmpty(parts); container.appendChild(card); return; }

  const W = 640, ROWH = 34, PADL = 110, PADT = 6;
  const H = PADT * 2 + rows.length * ROWH;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "viz-svg", role: "img" });
  const maxV = niceMax(Math.max(...rows.map((r) => r.total)));
  const xScale = (v) => (v / maxV) * (W - PADL - 56);

  rows.forEach((r, i) => {
    const cy = PADT + ROWH * i + ROWH / 2;
    const name = svg("text", { x: PADL - 10, y: cy + 4, "text-anchor": "end", class: "viz-cat" });
    name.textContent = truncLabel(r.name, 13); // 100px 거터 — 전체 이름은 툴팁·표에
    root.appendChild(name);
    let xCursor = PADL;
    const segs = IMP_ORDER.filter((imp) => r[imp] > 0);
    segs.forEach((imp, idx) => {
      const isLast = idx === segs.length - 1;
      const w = Math.max(1, xScale(r[imp]) - (isLast ? 0 : 2)); // 2px 서피스 갭
      const barH = 18;
      const mark = isLast
        ? svg("path", { d: roundRightRect(xCursor, cy - barH / 2, w, barH, 4), fill: VIZ[imp] })
        : svg("rect", { x: xCursor, y: cy - barH / 2, width: w, height: barH, fill: VIZ[imp] });
      root.appendChild(mark);
      xCursor += xScale(r[imp]);
    });
    // 값은 바 끝에 (선택적 직접 라벨 — 총계만)
    const val = svg("text", { x: xCursor + 8, y: cy + 4, class: "viz-val" });
    val.textContent = String(r.total);
    root.appendChild(val);
    const hit = svg("rect", { x: 0, y: PADT + ROWH * i, width: W, height: ROWH, fill: "transparent" });
    bindTip(hit, () => [r.name, IMP_ORDER.map((imp) => ({ label: IMP_LABEL[imp], value: String(r[imp]), color: VIZ[imp] }))]);
    root.appendChild(hit);
  });
  chartBody.appendChild(root);

  tableBody.appendChild(dataTable(["경쟁사", "상", "중", "하", "계"],
    rowsAll.map((r) => [r.name, r.high, r.medium, r.low, r.total])));
  container.appendChild(card);
}

// ── 차트 3/4: 단일 시리즈 수평 바 (키워드/출처 — 명목 카테고리 = 한 색) ──
function renderTopBar(container, title, entries, capNote) {
  const top = entries.slice(0, 8);
  const note = entries.length > 8 ? `상위 8개 표시 (외 ${entries.length - 8}개는 표에서)` : capNote || null;
  const parts = chartCard(title, note);
  const { card, chartBody, tableBody } = parts;
  if (!top.length) { markEmpty(parts); container.appendChild(card); return; }

  const W = 640, ROWH = 30, PADL = 150, PADT = 6;
  const H = PADT * 2 + top.length * ROWH;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "viz-svg", role: "img" });
  const maxV = niceMax(top[0][1]);
  top.forEach(([name, v], i) => {
    const cy = PADT + ROWH * i + ROWH / 2;
    const lbl = svg("text", { x: PADL - 10, y: cy + 4, "text-anchor": "end", class: "viz-cat" });
    lbl.textContent = truncLabel(name, 20); // 140px 거터 — CJK 폭 고려 절단
    root.appendChild(lbl);
    const w = Math.max(1, (v / maxV) * (W - PADL - 56));
    root.appendChild(svg("path", { d: roundRightRect(PADL, cy - 8, w, 16, 4), fill: VIZ.blue }));
    const val = svg("text", { x: PADL + w + 8, y: cy + 4, class: "viz-val" });
    val.textContent = String(v);
    root.appendChild(val);
    const hit = svg("rect", { x: 0, y: PADT + ROWH * i, width: W, height: ROWH, fill: "transparent" });
    bindTip(hit, () => [name, [{ label: "항목", value: String(v), color: VIZ.blue }]]);
    root.appendChild(hit);
  });
  chartBody.appendChild(root);
  tableBody.appendChild(dataTable(["항목", "건수"], entries.map(([n, v]) => [n, v])));
  container.appendChild(card);
}

// ── 차트 5: 경쟁사 × 키워드 히트맵 (순차 램프 — 라이트에서 진할수록 많음) ──
function renderHeatmap(container, items) {
  const comps = countBy(items, (it) => it.competitor).slice(0, 6).map(([n]) => n);
  const kws = countBy(items, (it) => it.keyword).slice(0, 6).map(([n]) => n);
  const parts = chartCard("경쟁사 × 키워드", "진할수록 항목이 많음");
  const { card, chartBody, tableBody } = parts;
  if (comps.length < 1 || kws.length < 1) { markEmpty(parts); container.appendChild(card); return; }

  // 키는 튜플 직렬화 — 공백 결합은 ("Acme Corp","가격") vs ("Acme","Corp 가격") 충돌을 일으킨다
  const cellKey = (c, k) => JSON.stringify([c, k]);

  const counts = new Map();
  let maxC = 0;
  for (const it of items) {
    if (!comps.includes(it.competitor) || !kws.includes(it.keyword)) continue;
    const k = cellKey(it.competitor, it.keyword);
    const v = (counts.get(k) || 0) + 1;
    counts.set(k, v);
    if (v > maxC) maxC = v;
  }

  const CELL = 64, CELLH = 40, PADL = 110, PADT = 54;
  const W = Math.max(640, PADL + kws.length * CELL + 16);
  const H = PADT + comps.length * CELLH + 8;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "viz-svg", role: "img" });

  kws.forEach((kw, j) => {
    const t = svg("text", { x: PADL + j * CELL + CELL / 2, y: PADT - 12, "text-anchor": "middle", class: "viz-axis" });
    t.textContent = truncLabel(kw, 10); // 64px 피치 — CJK 폭 고려
    root.appendChild(t);
  });
  comps.forEach((comp, i) => {
    const t = svg("text", { x: PADL - 10, y: PADT + i * CELLH + CELLH / 2 + 4, "text-anchor": "end", class: "viz-cat" });
    t.textContent = truncLabel(comp, 13); // 100px 거터 — 전체 이름은 툴팁·표에
    root.appendChild(t);
    kws.forEach((kw, j) => {
      const v = counts.get(cellKey(comp, kw)) || 0;
      const step = v === 0 ? null : VIZ.ramp[Math.min(VIZ.ramp.length - 1, Math.ceil((v / maxC) * VIZ.ramp.length) - 1)];
      const cell = svg("rect", {
        x: PADL + j * CELL + 1, y: PADT + i * CELLH + 1,
        width: CELL - 2, height: CELLH - 2, rx: 4,
        fill: step || "transparent",
        stroke: step ? "none" : VIZ.grid, "stroke-width": step ? 0 : 1,
      });
      bindTip(cell, () => [`${comp} · ${kw}`, [{ label: "항목", value: String(v), color: step || VIZ.grid }]]);
      root.appendChild(cell);
      if (v > 0) {
        // 셀 안 라벨 — 배경 명도에 따라 잉크 선택
        const whiteInk = VIZ.ramp.indexOf(step) >= 3; // 라이트 램프: 진한 스텝(#2e75b6 4.84:1↑)만 흰 잉크
        const t2 = svg("text", { x: PADL + j * CELL + CELL / 2, y: PADT + i * CELLH + CELLH / 2 + 4, "text-anchor": "middle", class: "viz-cell", fill: whiteInk ? "#ffffff" : "#1a2233" });
        t2.textContent = String(v);
        root.appendChild(t2);
      }
    });
  });
  chartBody.appendChild(root);

  tableBody.appendChild(dataTable(["경쟁사", ...kws],
    comps.map((c2) => [c2, ...kws.map((kw) => counts.get(cellKey(c2, kw)) || 0)])));
  container.appendChild(card);
}

// ── 정성 1: 하이라이트 (중요도 상 항목) ──
function renderHighlights(container, items) {
  const card = h("div", "dash-card");
  card.appendChild(h("h2", "dash-title", "하이라이트 — 중요도 상"));
  const highs = items.filter((it) => it.importance === "high")
    .sort((a, b) => b.briefDate.localeCompare(a.briefDate));
  if (!highs.length) { card.appendChild(h("p", "dash-empty", "중요도 상 항목이 없습니다.")); container.appendChild(card); return; }
  if (highs.length > 8) card.appendChild(h("p", "dash-note", `최근 8건 표시 (전체 ${highs.length}건)`));
  const list = h("div", "hl-list");
  for (const it of highs.slice(0, 8)) {
    const row = h("div", "hl-item");
    const meta = h("div", "hl-meta");
    const b = h("span", "badge high", "상");
    meta.appendChild(b);
    meta.appendChild(h("span", "hl-dim", `${it.briefDate} · ${it.competitor || "-"}${it.keyword ? " · " + it.keyword : ""}`));
    row.appendChild(meta);
    row.appendChild(h("p", "hl-text", it.title || it.point || ""));
    if (it.source) {
      const a = h("a", "hl-src", hostOf(it.source) || it.source);
      a.href = it.source; a.target = "_blank"; a.rel = "noopener";
      row.appendChild(a);
    }
    list.appendChild(row);
  }
  card.appendChild(list);
  container.appendChild(card);
}

// ── 정성 2: 경쟁사 포커스 (규칙 기반 자동 요약) ──
function renderFocus(container, items) {
  const card = h("div", "dash-card");
  card.appendChild(h("h2", "dash-title", "경쟁사 포커스"));
  const comps = countBy(items, (it) => it.competitor).slice(0, 6);
  if (!comps.length) { card.appendChild(h("p", "dash-empty", "데이터 없음")); container.appendChild(card); return; }
  const list = h("div", "focus-list");
  for (const [name, total] of comps) {
    const its = items.filter((it) => it.competitor === name);
    const c = impCounts(its);
    const topKw = countBy(its, (it) => it.keyword)[0];
    const topSrc = countBy(its, (it) => hostOf(it.source))[0];
    const row = h("div", "focus-item");
    row.appendChild(h("strong", "focus-name", name));
    const parts = [`항목 ${total}건`];
    if (c.high > 0) parts.push(`상 ${c.high}건 (${Math.round((c.high / total) * 100)}%)`);
    if (topKw) parts.push(`키워드 집중: ${topKw[0]} (${topKw[1]}건)`);
    if (topSrc && topSrc[0]) parts.push(`주요 출처: ${topSrc[0]}`);
    row.appendChild(h("span", "focus-desc", parts.join(" · ")));
    list.appendChild(row);
  }
  card.appendChild(list);
  container.appendChild(card);
}

// ── 대시보드 전체 렌더 ──
function renderDashboard() {
  dashEl.textContent = "";
  const { briefs, items } = scoped();
  if (!briefs.length) {
    // 데이터가 있는데 전부 못 불러온 경우(file://, 네트워크 오류)와 진짜 빈 아카이브를 구분한다
    dashEl.appendChild(h("p", "dash-empty",
      allBriefings.length && loadFailures >= allBriefings.length
        ? "브리핑 데이터를 불러오지 못했습니다. 대시보드는 서버 또는 공개 URL에서 열어야 동작합니다 (file:// 에서는 카드·브리핑 페이지만 지원)."
        : "표시할 브리핑이 없습니다."));
    return;
  }
  if (loadFailures > 0) {
    dashEl.appendChild(h("p", "dash-warn",
      `⚠ 브리핑 ${loadFailures}건을 불러오지 못해 아래 수치가 실제보다 적을 수 있습니다.`));
  }
  renderKpis(dashEl, briefs, items);
  const grid = h("div", "dash-grid");
  renderTrend(grid, items);
  renderByCompetitor(grid, items);
  renderTopBar(grid, "키워드 상위", countBy(items, (it) => it.keyword));
  renderTopBar(grid, "출처 상위", countBy(items, (it) => hostOf(it.source)));
  dashEl.appendChild(grid);
  renderHeatmap(dashEl, items);
  const qual = h("div", "dash-grid");
  renderHighlights(qual, items);
  renderFocus(qual, items);
  dashEl.appendChild(qual);
}

// ── 뷰 토글 ──
const btnCards = document.getElementById("view-cards");
const btnDash = document.getElementById("view-dash");
let dashVisible = false;

function setView(dash) {
  dashVisible = dash;
  btnCards.classList.toggle("is-active", !dash);
  btnDash.classList.toggle("is-active", dash);
  btnCards.setAttribute("aria-pressed", String(!dash));
  btnDash.setAttribute("aria-pressed", String(dash));
  cardsEl.hidden = dash;
  impFilterEl.hidden = dash; // 중요도는 대시보드의 인코딩 차원이라 필터로는 숨김
  if (dash) emptyEl.hidden = true;
  dashEl.hidden = !dash;
  if (dash) ensureDashData().then(renderDashboard);
  else if (typeof renderCards === "function") renderCards();
}
btnCards.addEventListener("click", () => setView(false));
btnDash.addEventListener("click", () => setView(true));

// 경쟁사 필터 변경 시 대시보드도 같은 슬라이스로 재렌더 (app.js 리스너가 먼저 상태를 갱신)
document.getElementById("competitor-filters").addEventListener("click", (e) => {
  if (e.target.closest(".filter-btn") && dashVisible) {
    emptyEl.hidden = true; // app.js renderCards()가 카드 기준으로 다시 노출시킨 empty 문구를 되숨김
    ensureDashData().then(renderDashboard);
  }
});

// URL ?view=dash 로 대시보드 직접 진입 — 인덱스 로드 완료(빈 배열 포함)를 기다린다
if (new URLSearchParams(location.search).get("view") === "dash") {
  const wait = setInterval(() => {
    if (window.__indexLoaded) { clearInterval(wait); setView(true); }
  }, 50);
  // 아주 느린 회선 폴백: 15초 후에는 로드 여부와 무관하게 요청된 뷰를 연다
  // (ensureDashData 가 인덱스 변화를 감지해 다음 렌더에서 재적재하므로 복구 가능)
  setTimeout(() => { clearInterval(wait); if (!dashVisible) setView(true); }, 15000);
}
