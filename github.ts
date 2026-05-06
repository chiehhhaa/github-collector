export interface ParsedRepo {
  owner: string;
  repo: string;
  normalizedUrl: string;
}

export function parseGitHubUrl(input: string): ParsedRepo {
  const trimmed = input.trim();
  const match = trimmed.match(
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i,
  );
  if (!match) {
    throw new Error("無法解析 GitHub URL，請確認格式為 https://github.com/owner/repo");
  }
  const [, owner, repo] = match;
  return {
    owner,
    repo,
    normalizedUrl: `https://github.com/${owner}/${repo}`,
  };
}

export async function fetchReadme(owner: string, repo: string): Promise<string> {
  const url = `https://r.jina.ai/https://github.com/${owner}/${repo}`;
  const res = await fetch(url, {
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) {
    throw new Error(`抓取 README 失敗 (${res.status} ${res.statusText})`);
  }
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("抓到的 README 內容為空，可能是 repo 不存在或為私有");
  }
  return text;
}

const BLOCKED_DOMAINS = [
  "github.com",
  "githubusercontent.com",
  "twitter.com",
  "x.com",
  "discord.gg",
  "discord.com",
  "youtube.com",
  "youtu.be",
  "npmjs.com",
  "facebook.com",
  "linkedin.com",
];

export function filterRelevantLinks(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!/^https?:\/\//i.test(u)) continue;
    let host: string;
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      continue;
    }
    const blocked = BLOCKED_DOMAINS.some(
      (d) => host === d || host.endsWith("." + d),
    );
    if (blocked) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= 3) break;
  }
  return out;
}

export interface ExternalContent {
  url: string;
  content: string;
}

export async function fetchExternalContent(
  urls: string[],
): Promise<ExternalContent[]> {
  const MAX_CHARS_PER_PAGE = 12_000;
  const TIMEOUT_MS = 15_000;

  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`https://r.jina.ai/${url}`, {
          headers: { Accept: "text/plain" },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!text.trim()) throw new Error("empty");
        return { url, content: text.slice(0, MAX_CHARS_PER_PAGE) };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const ok: ExternalContent[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      ok.push(r.value);
    } else {
      console.warn(`[fetchExternal] ${urls[i]} failed: ${r.reason}`);
    }
  }
  return ok;
}
