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
