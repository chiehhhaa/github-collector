import type { AnalysisData, Evaluation } from "./db.ts";

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scoreColor(score: number): string {
  if (score >= 50) return "text-score-excellent";
  if (score >= 40) return "text-score-good";
  if (score >= 30) return "text-score-ok";
  if (score >= 20) return "text-score-poor";
  return "text-score-bad";
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        cream: { 50: '#faf6f0', 100: '#f3ece2', 200: '#e6dccb' },
        paper: '#fdfaf5',
        ink: { 900: '#3d3833', 700: '#5a544c', 500: '#86807a', 400: '#a8a29a', 300: '#c8c0b6' },
        sage: { 300: '#bccab0', 400: '#9eb094', 500: '#7e9476', 600: '#647a5e', 700: '#4d5f49' },
        score: {
          excellent: '#7a9474',
          good:      '#6f8aa0',
          ok:        '#b89a6a',
          poor:      '#a87a5e',
          bad:       '#966868',
        },
      },
      boxShadow: {
        soft: '0 2px 8px -2px rgba(80, 70, 55, 0.08), 0 1px 3px -1px rgba(80, 70, 55, 0.06)',
      },
    },
  },
};
</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC', 'Segoe UI', sans-serif; }
.md { line-height: 1.8; }
.md pre { background:#2a2520 !important; color:#f3ece2; padding:0.9rem 1.1rem; border-radius:0.5rem; overflow-x:auto; font-size:0.85rem; line-height:1.6; margin:0.7rem 0; border:1px solid #3a342e; }
.md code { background:#f3ece2; color:#5a544c; padding:0.1rem 0.4rem; border-radius:0.25rem; font-size:0.9em; }
.md pre code { background:transparent !important; padding:0; color:inherit; }
.md pre code.hljs { background:transparent !important; padding:0; }
.md p { margin: 0.5rem 0; }
.md ul { list-style: disc; padding-left: 1.5rem; margin: 0.5rem 0; }
.md ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
.md li { margin: 0.25rem 0; }
.md a { color:#4d5f49; text-decoration: underline; }
.md h1, .md h2, .md h3 { font-weight: 600; margin: 0.6rem 0; color:#3d3833; }
dd { line-height: 1.8; }
</style>
</head>
<body class="bg-cream-50 min-h-screen text-ink-700 leading-relaxed">
<div class="max-w-4xl mx-auto px-4 py-8">
<header class="mb-8 flex items-center justify-between border-b border-cream-200 pb-4">
<a href="/" class="text-xl font-bold text-ink-900">📦 GitHub Repo 評估收藏</a>
<nav class="space-x-4 text-sm">
<a href="/" class="text-sage-700 hover:underline">首頁</a>
<a href="/history" class="text-sage-700 hover:underline">歷史紀錄</a>
</nav>
</header>
${body}
</div>
<div id="loading-overlay" class="hidden fixed inset-0 bg-ink-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
<div class="bg-paper rounded-xl shadow-2xl px-8 py-10 max-w-sm mx-4 text-center border border-cream-200">
<div class="inline-block w-14 h-14 border-4 border-sage-500 border-t-transparent rounded-full animate-spin"></div>
<h2 class="text-lg font-semibold mt-5 text-ink-900">AI 正在評估中</h2>
<p class="text-sm text-ink-500 mt-2 leading-relaxed">抓取 README 並交給 Gemini 分析<br>通常需要 10-30 秒，請稍候</p>
</div>
</div>
<script>
document.querySelectorAll('.md').forEach(function (el) {
  var raw = el.textContent || '';
  if (raw.trim()) el.innerHTML = marked.parse(raw);
});
if (window.hljs) {
  document.querySelectorAll('.md pre code').forEach(function (block) {
    try { hljs.highlightElement(block); } catch (e) {}
  });
}
(function () {
  var overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  document.querySelectorAll('.js-loading-form').forEach(function (form) {
    form.addEventListener('submit', function () {
      overlay.classList.remove('hidden');
      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.setAttribute('data-original-text', btn.textContent || '');
        btn.disabled = true;
        btn.textContent = '評估中...';
      }
    });
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      overlay.classList.add('hidden');
      document.querySelectorAll('.js-loading-form button[type="submit"]').forEach(function (btn) {
        btn.disabled = false;
        var orig = btn.getAttribute('data-original-text');
        if (orig !== null) btn.textContent = orig;
      });
    }
  });
})();
</script>
</body>
</html>`;
}

export function homePage(recent: Evaluation[]): string {
  const recentHtml =
    recent.length === 0
      ? ""
      : `
<section class="mt-10">
<h2 class="text-lg font-semibold mb-3 text-ink-900">最近評估</h2>
<ul class="divide-y divide-cream-200 bg-paper rounded-lg border border-cream-200 shadow-soft">
${recent
  .map(
    (e) => `
<li class="px-4 py-3 flex items-center justify-between hover:bg-cream-50 transition">
<div class="min-w-0">
<a href="/result/${e.id}" class="font-medium text-sage-700 hover:underline truncate block">${escapeHtml(e.repo_name)}</a>
<div class="text-xs text-ink-400 mt-0.5">${escapeHtml(e.created_at)} · ${escapeHtml(e.recommend)}</div>
</div>
<div class="text-2xl font-bold ${scoreColor(e.total_score)} shrink-0 ml-4">${e.total_score}</div>
</li>`,
  )
  .join("")}
</ul>
</section>`;

  return layout(
    "首頁 - GitHub Repo 評估收藏",
    `
<section class="bg-paper rounded-lg shadow-soft p-8 border border-cream-200">
<h1 class="text-2xl font-bold mb-2 text-ink-900">貼上 GitHub URL，30 秒內拿到完整分析</h1>
<p class="text-ink-500 mb-6">輸入專案連結，AI 會幫你產出概覽、用法、評分卡與行動建議。</p>
<form action="/evaluate" method="post" class="js-loading-form space-y-4">
<input type="url" name="url" required placeholder="https://github.com/owner/repo"
  class="w-full bg-cream-50 border border-cream-200 text-ink-700 placeholder-ink-400 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-sage-400 transition" />
<button type="submit"
  class="w-full bg-sage-500 hover:bg-sage-600 disabled:bg-sage-300 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition">
  開始評估
</button>
</form>
<p class="text-xs text-ink-400 mt-4">同樣的 URL 重複貼會直接回傳之前的結果，不會多花 API 費用。</p>
</section>
${recentHtml}
`,
  );
}

export function reportPage(ev: Evaluation): string {
  const data = JSON.parse(ev.analysis_json) as AnalysisData;
  const scoreEntries: Array<[string, number]> = [
    ["實用性", data.scores.practicality],
    ["學習價值", data.scores.learning_value],
    ["上手難度", data.scores.ease_of_use],
    ["維護健康度", data.scores.maintenance],
    ["長期可靠度", data.scores.reliability],
    ["相關性", data.scores.relevance],
  ];
  const scoreBars = scoreEntries
    .map(
      ([label, v]) => `
<div class="flex items-center gap-3">
<div class="w-24 text-sm text-ink-500 shrink-0">${label}</div>
<div class="flex-1 bg-cream-100 rounded-full h-2.5">
<div class="bg-sage-500 h-2.5 rounded-full" style="width: ${v * 10}%"></div>
</div>
<div class="w-14 text-right font-semibold shrink-0 text-ink-700">${v}<span class="text-ink-300 text-xs">/10</span></div>
</div>`,
    )
    .join("");

  const detailsHtml =
    data.details && data.details.length > 0
      ? `
<section class="bg-paper rounded-lg shadow-soft p-6 border border-cream-200">
<h2 class="text-lg font-semibold mb-4 text-ink-900">📖 詳細內容<span class="text-sm font-normal text-ink-400 ml-2">（${data.details.length} 項）</span></h2>
<div class="space-y-5">
${data.details
  .map(
    (item, i) => `
<div class="${i > 0 ? "pt-5 border-t border-cream-200" : ""}">
<h3 class="font-semibold text-ink-900 text-base mb-2 flex items-baseline gap-2"><span class="text-sage-500 text-sm font-mono">${String(i + 1).padStart(2, "0")}</span>${escapeHtml(item.title)}</h3>
<div class="md text-ink-700 text-sm pl-7">${escapeHtml(item.body)}</div>
</div>`,
  )
  .join("")}
</div>
</section>`
      : "";

  return layout(
    `${ev.repo_name} - 評估報告`,
    `
<article class="space-y-6">
<section class="bg-paper rounded-lg shadow-soft p-6 border border-cream-200">
<div class="flex items-start justify-between gap-4 flex-wrap">
<div class="min-w-0 flex-1">
<h1 class="text-2xl font-bold break-all text-ink-900">${escapeHtml(ev.repo_name)}</h1>
<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" class="text-sm text-sage-700 hover:underline break-all">${escapeHtml(ev.url)}</a>
<div class="text-xs text-ink-400 mt-1">${
      ev.updated_at && ev.updated_at !== ev.created_at
        ? `最後評估於 ${escapeHtml(ev.updated_at)} · 收藏於 ${escapeHtml(ev.created_at)}`
        : `評估於 ${escapeHtml(ev.created_at)}`
    }</div>
<form action="/evaluate" method="post" class="js-loading-form mt-3">
<input type="hidden" name="url" value="${escapeHtml(ev.url)}" />
<input type="hidden" name="force" value="1" />
<button type="submit" class="text-xs text-sage-700 hover:text-sage-600 hover:underline cursor-pointer">↻ 重新評估</button>
</form>
</div>
<div class="text-right shrink-0">
<div class="text-5xl font-bold ${scoreColor(ev.total_score)}">${ev.total_score}<span class="text-xl text-ink-300"> / 60</span></div>
<div class="mt-1 text-sm font-medium ${scoreColor(ev.total_score)}">${escapeHtml(ev.recommend)}</div>
</div>
</div>
</section>

<section class="bg-paper rounded-lg shadow-soft p-6 border border-cream-200">
<h2 class="text-lg font-semibold mb-4 text-ink-900">📌 專案概覽</h2>
<dl class="space-y-3 text-sm">
<div><dt class="font-medium text-ink-500">一句話描述</dt><dd class="mt-1 text-ink-700">${escapeHtml(data.overview.one_liner)}</dd></div>
<div><dt class="font-medium text-ink-500">核心問題</dt><dd class="mt-1 md text-ink-700">${escapeHtml(data.overview.problem)}</dd></div>
<div><dt class="font-medium text-ink-500">適合誰用</dt><dd class="mt-1 md text-ink-700">${escapeHtml(data.overview.target_user)}</dd></div>
</dl>
</section>

<section class="bg-paper rounded-lg shadow-soft p-6 border border-cream-200">
<h2 class="text-lg font-semibold mb-4 text-ink-900">🚀 怎麼用</h2>
<div class="space-y-4 text-sm">
<div><div class="font-medium text-ink-500 mb-1">安裝方式</div><div class="md text-ink-700">${escapeHtml(data.how_to_use.install)}</div></div>
<div><div class="font-medium text-ink-500 mb-1">基本使用範例</div><div class="md text-ink-700">${escapeHtml(data.how_to_use.example)}</div></div>
<div><div class="font-medium text-ink-500 mb-1">典型使用場景</div><div class="md text-ink-700">${escapeHtml(data.how_to_use.use_cases)}</div></div>
</div>
</section>

<section class="bg-paper rounded-lg shadow-soft p-6 border border-cream-200">
<h2 class="text-lg font-semibold mb-4 text-ink-900">📊 評分卡</h2>
<div class="space-y-3">${scoreBars}</div>
<div class="mt-5 pt-4 border-t border-cream-200 flex items-center justify-between">
<span class="text-ink-500">總分</span>
<span class="text-2xl font-bold ${scoreColor(ev.total_score)}">${ev.total_score} / 60</span>
</div>
</section>

<section class="bg-paper rounded-lg shadow-soft p-6 border border-cream-200">
<h2 class="text-lg font-semibold mb-4 text-ink-900">🧭 補充判斷</h2>
<dl class="space-y-3 text-sm">
<div><dt class="font-medium text-ink-500">替代方案</dt><dd class="mt-1 md text-ink-700">${escapeHtml(data.supplement.alternatives)}</dd></div>
<div><dt class="font-medium text-ink-500">適合搭配</dt><dd class="mt-1 md text-ink-700">${escapeHtml(data.supplement.pairs_with)}</dd></div>
<div><dt class="font-medium text-ink-500">最終建議</dt><dd class="mt-1 md text-ink-700">${escapeHtml(data.supplement.final_advice)}</dd></div>
</dl>
</section>
${detailsHtml}
</article>
`,
  );
}

export function historyPage(list: Evaluation[]): string {
  const body =
    list.length === 0
      ? `<div class="bg-paper rounded-lg shadow-soft p-8 text-center text-ink-500 border border-cream-200">還沒有評估紀錄。<a href="/" class="text-sage-700 hover:underline">回首頁開始第一筆</a></div>`
      : `
<div class="bg-paper rounded-lg shadow-soft overflow-hidden border border-cream-200">
<table class="w-full text-sm">
<thead class="bg-cream-100 text-ink-500 text-left">
<tr>
<th class="px-4 py-3 font-medium">專案</th>
<th class="px-4 py-3 w-24 text-center font-medium">總分</th>
<th class="px-4 py-3 font-medium">推薦等級</th>
<th class="px-4 py-3 w-44 font-medium">評估時間</th>
</tr>
</thead>
<tbody class="divide-y divide-cream-200">
${list
  .map(
    (e) => `
<tr class="hover:bg-cream-50 transition">
<td class="px-4 py-3"><a href="/result/${e.id}" class="text-sage-700 font-medium hover:underline">${escapeHtml(e.repo_name)}</a></td>
<td class="px-4 py-3 text-center font-bold ${scoreColor(e.total_score)}">${e.total_score}</td>
<td class="px-4 py-3 text-ink-700">${escapeHtml(e.recommend)}</td>
<td class="px-4 py-3 text-ink-400 text-xs">${escapeHtml(e.created_at)}</td>
</tr>`,
  )
  .join("")}
</tbody>
</table>
</div>`;
  return layout(
    "歷史紀錄",
    `
<h1 class="text-xl font-bold mb-4 text-ink-900">歷史評估紀錄（${list.length}）</h1>
${body}
`,
  );
}

export function errorPage(message: string): string {
  return layout(
    "發生錯誤",
    `
<div class="bg-paper rounded-lg shadow-soft p-8 text-center border border-cream-200">
<div class="text-5xl mb-3">⚠️</div>
<h1 class="text-xl font-bold mb-2 text-ink-900">出了一點狀況</h1>
<p class="text-ink-500 mb-4 break-words">${escapeHtml(message)}</p>
<a href="/" class="inline-block bg-sage-500 hover:bg-sage-600 text-white px-5 py-2 rounded-lg transition">回首頁</a>
</div>
`,
  );
}
