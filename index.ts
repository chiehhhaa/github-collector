/// <reference types="bun" />

import {
  findById,
  findByUrl,
  getRecommendLevel,
  insert,
  listAll,
} from "./db.ts";
import { fetchReadme, parseGitHubUrl } from "./github.ts";
import { analyzeRepo, calculateTotal } from "./ai.ts";
import { errorPage, historyPage, homePage, reportPage } from "./templates.ts";

const port = Number(Bun.env.PORT) || 3000;

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === "GET" && path === "/") {
        const recent = listAll().slice(0, 5);
        return html(homePage(recent));
      }

      if (method === "POST" && path === "/evaluate") {
        return await handleEvaluate(req);
      }

      if (method === "GET" && path === "/history") {
        return html(historyPage(listAll()));
      }

      const resultMatch = path.match(/^\/result\/(\d+)$/);
      if (method === "GET" && resultMatch) {
        const id = Number(resultMatch[1]);
        const ev = findById(id);
        if (!ev) return html(errorPage(`找不到 ID 為 ${id} 的評估`), 404);
        return html(reportPage(ev));
      }

      return html(errorPage(`找不到頁面：${path}`), 404);
    } catch (err) {
      console.error("[error]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return html(errorPage(msg), 500);
    }
  },
});

console.log(
  `🚀 GitHub Repo 評估收藏工具 running at http://localhost:${server.port}`,
);

async function handleEvaluate(req: Request): Promise<Response> {
  const form = await req.formData();
  const inputUrl = String(form.get("url") || "").trim();
  if (!inputUrl) return html(errorPage("請輸入 GitHub URL"), 400);

  let parsed;
  try {
    parsed = parseGitHubUrl(inputUrl);
  } catch (e) {
    return html(errorPage((e as Error).message), 400);
  }

  const cached = findByUrl(parsed.normalizedUrl);
  if (cached) {
    console.log(
      `[evaluate] cache hit: ${parsed.owner}/${parsed.repo} → id=${cached.id}`,
    );
    return redirect(`/result/${cached.id}`);
  }

  console.log(`[evaluate] fetching README: ${parsed.owner}/${parsed.repo}`);
  const readme = await fetchReadme(parsed.owner, parsed.repo);

  console.log(
    `[evaluate] analyzing with Claude (readme ${readme.length} chars)...`,
  );
  const repoFullName = `${parsed.owner}/${parsed.repo}`;
  const analysis = await analyzeRepo(readme, repoFullName);
  const total = calculateTotal(analysis.scores);
  const recommend = getRecommendLevel(total);

  const id = insert({
    url: parsed.normalizedUrl,
    repo_name: repoFullName,
    total_score: total,
    recommend,
    analysis_json: JSON.stringify(analysis),
  });

  console.log(`[evaluate] saved id=${id} score=${total} (${recommend})`);
  return redirect(`/result/${id}`);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location },
  });
}
