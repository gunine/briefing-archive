// 공개 아카이브 (화면2) — 정적. data/index.json + data/briefings/<id>.json 만 읽는다.

const IMPORTANCE = {
  high: { label: "상", rank: 3 },
  medium: { label: "중", rank: 2 },
  low: { label: "하", rank: 1 },
};
const rank = (imp) => IMPORTANCE[imp]?.rank || 0;

const el = {
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  filters: document.getElementById("filters"),
  competitorFilters: document.getElementById("competitor-filters"),
  modal: document.getElementById("modal"),
  modalBody: document.getElementById("modal-body"),
};

let allBriefings = [];
let activeFilter = "all";        // 중요도 필터
let activeCompetitor = "all";    // 경쟁사 필터

function badge(importance, text) {
  const info = IMPORTANCE[importance] || IMPORTANCE.low;
  return `<span class="badge ${importance}">${text != null ? text : info.label}</span>`;
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// 모든 브리핑에서 등장하는 경쟁사 (필터 칩용)
function allCompetitors() {
  const set = new Set();
  allBriefings.forEach((b) => (b.competitors || []).forEach((c) => set.add(c)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function renderCompetitorFilters() {
  const comps = allCompetitors();
  if (comps.length === 0) { el.competitorFilters.innerHTML = ""; return; }
  const chip = (val, label) =>
    `<button class="filter-btn ${activeCompetitor === val ? "is-active" : ""}" data-competitor="${escapeHtml(val)}">${escapeHtml(label)}</button>`;
  el.competitorFilters.innerHTML =
    `<span class="filter-label">경쟁사</span>` + chip("all", "전체") + comps.map((c) => chip(c, c)).join("");
}

function renderCards() {
  const list = allBriefings
    .filter((b) => activeFilter === "all" || b.importance === activeFilter)
    .filter((b) => activeCompetitor === "all" || (b.competitors || []).includes(activeCompetitor))
    .sort((a, b) => b.date.localeCompare(a.date));

  el.empty.hidden = list.length > 0;
  el.cards.innerHTML = list.map((b) => {
    const chips = (b.competitors || [])
      .map((c) => `<span class="chip ${c === activeCompetitor ? "chip-active" : ""}">${escapeHtml(c)}</span>`)
      .join("");
    return `
    <button class="card" data-id="${escapeHtml(b.id)}">
      <div class="card-top">
        <span class="card-date">${escapeHtml(b.date)}</span>
        ${badge(b.importance)}
      </div>
      <h2 class="card-title">${escapeHtml(b.title)}</h2>
      <p class="card-summary">${escapeHtml(b.summary)}</p>
      ${chips ? `<div class="card-chips">${chips}</div>` : ""}
    </button>`;
  }).join("");
}

async function openDetail(id) {
  try {
    const res = await fetch(`data/briefings/${id}.json`);
    if (!res.ok) throw new Error(`상세를 불러오지 못했습니다 (${res.status})`);
    const b = await res.json();
    renderDetail(b);
    el.modal.hidden = false;
    document.body.style.overflow = "hidden";
  } catch (err) {
    alert(err.message);
  }
}

// 브리핑에 등장하는 경쟁사 (등록 목록 ∪ 항목의 경쟁사)
function competitorsOf(b) {
  const set = new Set(b.competitors || []);
  (b.items || []).forEach((it) => { if (it.competitor) set.add(it.competitor); });
  return [...set];
}

function importanceCounts(items) {
  const c = { high: 0, medium: 0, low: 0 };
  items.forEach((it) => { if (c[it.importance] !== undefined) c[it.importance]++; });
  return c;
}

// 경쟁사 비교 요약표 (2명 이상일 때만)
function renderCompareTable(b, comps) {
  if (comps.length < 2) return "";
  const rows = comps.map((name) => {
    const its = (b.items || []).filter((it) => it.competitor === name);
    const c = importanceCounts(its);
    const cell = (n, imp) => (n ? badge(imp, n) : '<span class="cmp-zero">·</span>');
    return `<tr>
      <td class="cmp-name">${escapeHtml(name)}</td>
      <td class="cmp-total">${its.length}</td>
      <td>${cell(c.high, "high")}</td>
      <td>${cell(c.medium, "medium")}</td>
      <td>${cell(c.low, "low")}</td>
    </tr>`;
  }).join("");
  return `
    <div class="compare">
      <h3 class="compare-heading">경쟁사 비교</h3>
      <table class="compare-table">
        <thead><tr><th>경쟁사</th><th>계</th><th>상</th><th>중</th><th>하</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderItem(it) {
  return `
    <div class="item ${it.importance}">
      <div class="item-head">
        ${badge(it.importance)}
        <span class="item-meta">${escapeHtml(it.competitor)}${it.keyword ? " · " + escapeHtml(it.keyword) : ""}${it.date ? " · " + escapeHtml(it.date) : ""}</span>
      </div>
      ${it.title ? `<p class="item-title">${escapeHtml(it.title)}</p>` : ""}
      ${it.point ? `<p class="item-point">${escapeHtml(it.point)}</p>` : ""}
      ${it.source ? `<a class="item-source" href="${escapeHtml(it.source)}" target="_blank" rel="noopener">${escapeHtml(it.source)}</a>` : ""}
    </div>`;
}

// 항목을 경쟁사별로 묶어 렌더링 (그룹 내 중요도순)
function renderGroupedItems(b, comps) {
  return comps.map((name) => {
    const its = (b.items || [])
      .filter((it) => it.competitor === name)
      .sort((x, y) => rank(y.importance) - rank(x.importance));
    if (its.length === 0) return "";
    return `
      <div class="cmp-group">
        <h3 class="cmp-group-title">${escapeHtml(name)} <span class="cmp-group-count">${its.length}</span></h3>
        <div class="items">${its.map(renderItem).join("")}</div>
      </div>`;
  }).join("");
}

function renderDetail(b) {
  const comps = competitorsOf(b);
  const keywordTags = (b.keywords || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");

  el.modalBody.innerHTML = `
    <div class="detail-date">${escapeHtml(b.date)} ${badge(b.importance)}</div>
    <h2 class="detail-title" id="modal-title">${escapeHtml(b.title)}</h2>
    <p class="detail-summary">${escapeHtml(b.summary)}</p>
    ${keywordTags ? `<div class="tags">${keywordTags}</div>` : ""}
    ${renderCompareTable(b, comps)}
    ${renderGroupedItems(b, comps)}
  `;
}

function closeModal() {
  el.modal.hidden = true;
  document.body.style.overflow = "";
}

// 이벤트
el.cards.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) openDetail(card.dataset.id);
});

el.filters.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  el.filters.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  renderCards();
});

el.competitorFilters.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  activeCompetitor = btn.dataset.competitor;
  renderCompetitorFilters();
  renderCards();
});

el.modal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeModal();
});

async function init() {
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error(`목록을 불러오지 못했습니다 (${res.status})`);
    allBriefings = await res.json();
    renderCompetitorFilters();
    renderCards();
    // URL ?id= 로 특정 브리핑 바로 열기
    const id = new URLSearchParams(location.search).get("id");
    if (id) openDetail(id);
  } catch (err) {
    el.empty.hidden = false;
    el.empty.textContent = err.message;
  } finally {
    window.__indexLoaded = true; // 대시보드 딥링크가 로드 완료(빈 배열 포함)를 알 수 있도록
  }
}

init();
