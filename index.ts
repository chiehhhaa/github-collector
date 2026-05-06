/// <reference types="bun" />

import {
  createUser,
  findBySeq,
  findByUrl,
  findUserByGithubId,
  findUserById,
  getRecommendLevel,
  linkGithubToUser,
  listAll,
  mergeUserData,
  refreshGithubProfile,
  touchUser,
  upsertEvaluation,
} from "./db.ts";
import {
  fetchExternalContent,
  fetchReadme,
  parseGitHubUrl,
} from "./github.ts";
import { analyzeRepo, calculateTotal, extractRelevantLinks } from "./ai.ts";
import { errorPage, historyPage, homePage, reportPage } from "./templates.ts";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGithubUser,
  generateState,
  isOAuthConfigured,
} from "./auth.ts";

const port = Number(Bun.env.PORT) || 3000;

const COOKIE_UID = "uid";
const COOKIE_STATE = "oauth_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function makeUidCookie(userId: string): string {
  return `${COOKIE_UID}=${userId}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`;
}

function clearUidCookie(): string {
  return `${COOKIE_UID}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function makeStateCookie(state: string): string {
  return `${COOKIE_STATE}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`;
}

function clearStateCookie(): string {
  return `${COOKIE_STATE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function getRedirectUri(req: Request): string {
  const u = new URL(req.url);
  // 走 reverse proxy（cloudflared / ngrok / Render / 等）時，原始 host 跟 protocol
  // 會被代理用 X-Forwarded-* header 傳進來。優先用這些算 public URL，否則用本機自己看到的。
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto");
  const host = fwdHost || u.host;
  const proto = fwdProto || u.protocol.replace(":", "");
  return `${proto}://${host}/auth/callback`;
}

function ensureUser(req: Request): { userId: string; setCookie: string | null } {
  const cookies = parseCookies(req.headers.get("cookie"));
  const cookieId = cookies[COOKIE_UID];

  if (cookieId && findUserById(cookieId)) {
    touchUser(cookieId);
    return { userId: cookieId, setCookie: null };
  }
  const userId = createUser();
  return { userId, setCookie: makeUidCookie(userId) };
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // 認證路由優先處理（不走 ensureUser，由各自的 handler 控制 cookie）
    if (method === "GET" && path === "/login") {
      return handleLogin(req);
    }
    if (method === "GET" && path === "/auth/callback") {
      return await handleAuthCallback(req);
    }
    if ((method === "GET" || method === "POST") && path === "/logout") {
      return handleLogout();
    }

    const { userId, setCookie } = ensureUser(req);
    const user = findUserById(userId);

    let response: Response;
    try {
      if (method === "GET" && path === "/") {
        const recent = listAll(userId).slice(0, 5);
        response = html(homePage(recent, user));
      } else if (method === "POST" && path === "/evaluate") {
        response = await handleEvaluate(req, userId);
      } else if (method === "GET" && path === "/history") {
        response = html(historyPage(listAll(userId), user));
      } else {
        const resultMatch = path.match(/^\/result\/(\d+)$/);
        if (method === "GET" && resultMatch) {
          const seq = Number(resultMatch[1]);
          const ev = findBySeq(userId, seq);
          if (!ev) {
            response = html(errorPage(`找不到第 ${seq} 筆評估`, user), 404);
          } else {
            response = html(reportPage(ev, user));
          }
        } else {
          response = html(errorPage(`找不到頁面：${path}`, user), 404);
        }
      }
    } catch (err) {
      console.error("[error]", err);
      const msg = err instanceof Error ? err.message : String(err);
      response = html(errorPage(msg, user), 500);
    }

    if (setCookie) response.headers.append("Set-Cookie", setCookie);
    return response;
  },
});

console.log(
  `🚀 GitHub Repo 評估收藏工具 running at http://localhost:${server.port}`,
);

function handleLogin(req: Request): Response {
  if (!isOAuthConfigured()) {
    return html(
      errorPage(
        "GitHub OAuth 尚未設定。請在 .env 填入 GITHUB_CLIENT_ID 與 GITHUB_CLIENT_SECRET（從 https://github.com/settings/developers 註冊取得）。",
        null,
      ),
      500,
    );
  }
  const state = generateState();
  const redirectUri = getRedirectUri(req);
  const authUrl = buildAuthorizeUrl(state, redirectUri);
  const res = new Response(null, {
    status: 302,
    headers: { Location: authUrl },
  });
  res.headers.append("Set-Cookie", makeStateCookie(state));
  return res;
}

async function handleAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return html(errorPage(`GitHub 拒絕授權：${error}`, null), 400);
  }
  if (!code || !state) {
    return html(errorPage("缺少 OAuth 必要參數", null), 400);
  }

  const cookies = parseCookies(req.headers.get("cookie"));
  if (cookies[COOKIE_STATE] !== state) {
    return html(errorPage("OAuth state 驗證失敗（可能是 CSRF 或 cookie 過期）", null), 400);
  }

  let profile;
  try {
    const token = await exchangeCodeForToken(code, getRedirectUri(req));
    profile = await fetchGithubUser(token);
  } catch (e) {
    return html(errorPage((e as Error).message, null), 500);
  }

  // 目前 cookie 上的 user（可能是匿名 user，剛剛才被建出來）
  const currentUid = cookies[COOKIE_UID];
  const currentUser = currentUid ? findUserById(currentUid) : null;

  // 看看這個 GitHub 帳號之前有沒有登入過
  const existingByGithub = findUserByGithubId(profile.github_id);

  let finalUserId: string;
  if (existingByGithub) {
    // 之前登過 → 沿用既有 user
    finalUserId = existingByGithub.id;
    refreshGithubProfile(finalUserId, profile);
    // 把目前匿名 user（如果有）的資料合併過來
    if (
      currentUser &&
      currentUser.id !== finalUserId &&
      !currentUser.github_id
    ) {
      mergeUserData(currentUser.id, finalUserId);
    }
  } else if (currentUser && !currentUser.github_id) {
    // 沒登入過 + 目前是匿名 user → 直接把這個 user 升級成 GitHub user
    finalUserId = currentUser.id;
    linkGithubToUser(finalUserId, profile);
  } else {
    // 邊角：cookie 是別的 GitHub user 或不存在 → 新建一個 user 並連結
    finalUserId = createUser();
    linkGithubToUser(finalUserId, profile);
  }

  const res = new Response(null, {
    status: 303,
    headers: { Location: "/" },
  });
  res.headers.append("Set-Cookie", makeUidCookie(finalUserId));
  res.headers.append("Set-Cookie", clearStateCookie());
  return res;
}

function handleLogout(): Response {
  const res = new Response(null, {
    status: 303,
    headers: { Location: "/" },
  });
  res.headers.append("Set-Cookie", clearUidCookie());
  return res;
}

async function handleEvaluate(
  req: Request,
  userId: string,
): Promise<Response> {
  const form = await req.formData();
  const inputUrl = String(form.get("url") || "").trim();
  const force = String(form.get("force") || "") === "1";
  const user = findUserById(userId);
  if (!inputUrl) return html(errorPage("請輸入 GitHub URL", user), 400);

  let parsed;
  try {
    parsed = parseGitHubUrl(inputUrl);
  } catch (e) {
    return html(errorPage((e as Error).message, user), 400);
  }

  const cached = findByUrl(userId, parsed.normalizedUrl);
  if (cached && !force) {
    console.log(
      `[evaluate] cache hit (user=${userId.slice(0, 8)}): ${parsed.owner}/${parsed.repo} → id=${cached.id}`,
    );
    return redirect(`/result/${cached.id}`);
  }

  console.log(
    `[evaluate] fetching README (user=${userId.slice(0, 8)}): ${parsed.owner}/${parsed.repo}`,
  );
  const readme = await fetchReadme(parsed.owner, parsed.repo);
  const repoFullName = `${parsed.owner}/${parsed.repo}`;

  console.log(`[evaluate] phase 1: scanning README for external links...`);
  const links = await extractRelevantLinks(readme, repoFullName);

  let external: Awaited<ReturnType<typeof fetchExternalContent>> = [];
  if (links.length > 0) {
    console.log(
      `[evaluate] phase 1: found ${links.length} link(s) → ${links.join(", ")}`,
    );
    console.log(`[evaluate] phase 2: fetching external content in parallel...`);
    external = await fetchExternalContent(links);
    console.log(
      `[evaluate] phase 2: fetched ${external.length}/${links.length} page(s)`,
    );
  } else {
    console.log(`[evaluate] phase 1: README looks self-contained, skipping`);
  }

  const totalChars =
    readme.length + external.reduce((sum, e) => sum + e.content.length, 0);
  console.log(
    `[evaluate] analyzing with Gemini (${totalChars} chars total, ${external.length} external source(s))...`,
  );
  const analysis = await analyzeRepo(readme, repoFullName, external);
  const total = calculateTotal(analysis.scores);
  const recommend = getRecommendLevel(total);

  const seq = upsertEvaluation({
    user_id: userId,
    url: parsed.normalizedUrl,
    repo_name: repoFullName,
    total_score: total,
    recommend,
    analysis_json: JSON.stringify(analysis),
  });
  console.log(
    `[evaluate] ${cached ? "updated" : "saved"} seq=${seq} score=${total} (${recommend})`,
  );
  return redirect(`/result/${seq}`);
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
