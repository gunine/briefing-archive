// 카드 인덱스 (화면2) — 카드는 index.html 에 정적 마크업으로 생성되고, 데이터는 window.__INDEX 로 내장된다.
// fetch 없음. 카드 클릭 = briefings/<id>.html 독립 페이지로 이동. 이 스크립트는 필터링만 담당한다.
// (dashboard.js 가 공유하는 전역: allBriefings, activeCompetitor, renderCards, window.__indexLoaded)

const el = {
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  filters: document.getElementById("filters"),
  competitorFilters: document.getElementById("competitor-filters"),
};

let allBriefings = Array.isArray(window.__INDEX) ? window.__INDEX : [];
let activeFilter = "all";        // 중요도 필터
let activeCompetitor = "all";    // 경쟁사 필터

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// 모든 브리핑에서 등장하는 경쟁사 (필터 칩)
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

// 정적 카드의 표시/숨김만 토글 (마크업은 배포 시 생성됨)
// 매거진 2단 그리드의 세로 분할선(col-right)은 '보이는' 카드 순서 기준으로 다시 배정한다
function renderCards() {
  let visible = 0;
  el.cards.querySelectorAll(".card").forEach((card) => {
    const imp = card.dataset.importance;
    let comps = [];
    try { comps = JSON.parse(card.dataset.competitors || "[]"); } catch { comps = []; }
    const show = (activeFilter === "all" || imp === activeFilter) &&
      (activeCompetitor === "all" || comps.includes(activeCompetitor));
    card.hidden = !show;
    if (show) {
      card.classList.toggle("col-right", visible % 2 === 1);
      visible++;
    }
  });
  el.empty.hidden = visible > 0;
}

// 필터 이벤트
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

renderCompetitorFilters();
renderCards();
window.__indexLoaded = true; // 데이터가 내장되어 즉시 로드 완료 (대시보드 딥링크용)
