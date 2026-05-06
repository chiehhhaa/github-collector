import type { GithubProfile } from "./db.ts";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

export function isOAuthConfigured(): boolean {
  return !!(Bun.env.GITHUB_CLIENT_ID && Bun.env.GITHUB_CLIENT_SECRET);
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = Bun.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new Error("GITHUB_CLIENT_ID 未設定");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  const clientId = Bun.env.GITHUB_CLIENT_ID;
  const clientSecret = Bun.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth 環境變數未設定");
  }

  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub token 交換失敗 (${res.status})`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (json.error || !json.access_token) {
    throw new Error(
      `GitHub OAuth 錯誤：${json.error_description || json.error || "no token"}`,
    );
  }
  return json.access_token;
}

export async function fetchGithubUser(token: string): Promise<GithubProfile> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "github-collector",
    },
  });
  if (!res.ok) {
    throw new Error(`抓取 GitHub user 失敗 (${res.status})`);
  }
  const u = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
  };
  return {
    github_id: String(u.id),
    github_login: u.login,
    github_name: u.name,
    github_avatar_url: u.avatar_url,
  };
}

export function generateState(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
