import type { AnalysisData } from "./db.ts";
import type { ExternalContent } from "./github.ts";
import { filterRelevantLinks } from "./github.ts";

const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_README_CHARS = 50_000;

const SYSTEM_PROMPT = `【最高優先規則】
所有 JSON 輸出的文字欄位**必須使用繁體中文（Traditional Chinese / zh-Hant）**撰寫，包括 overview、how_to_use、supplement、details 內所有 string 欄位。即使 README 是英文，你也要用繁體中文輸出評估報告。技術名詞（如 React、Bun、API）可保留英文，但描述、說明、建議都用繁體中文。

你是一位資深軟體工程師，專門快速評估開源專案對開發者的價值。
你會收到一個 GitHub 專案的 README 內容，必須產生結構化評估報告。

【欄位指引】
- overview.one_liner: 一句話描述這個專案是什麼
- overview.problem: 它解決什麼痛點
- overview.target_user: 適合誰用、目標使用者
- how_to_use.install: 安裝方式（指令必須用 \`\`\`bash code block 包裹，不可寫成 inline 純文字）
- how_to_use.example: 最小可用範例（程式碼必須用 \`\`\`js / \`\`\`ts / \`\`\`bash 等 code block 包裹）
- how_to_use.use_cases: 實際上會在什麼情況下用它
- supplement.alternatives: 類似的工具有哪些
- supplement.pairs_with: 通常跟哪些工具一起用
- supplement.final_advice: 根據評分給出明確的行動建議
- details: 從 README 中挑出值得單獨記錄的章節或項目，**最多 10 條**。例如：
    * Catalog 類 repo（如 mattpocock/skills、awesome-* 清單）：每個項目一條
    * 教學/食譜類 repo：每個重要步驟或範例一條
    * Library/Framework：每個核心 API、模組或重要概念一條
    * 工具類 repo：每個主要功能或指令一條
  每條格式為 { title, body }：
    * title: 該項目的名稱（短，noun phrase）
    * body: **精簡 60-120 字**繁體中文 markdown。重點是讓使用者快速理解「這項是什麼、何時用」，不要長篇大論複述 README。可含程式碼範例（用三反引號 fenced block）。
  如果 README 沒有可拆分的原子內容（例如純粹是專案介紹），回傳空陣列 []。
  不要為了湊數而拆，寧可少一點也要每條都有實際資訊。

【列表與多步驟格式】

列舉 3 個以上項目時用 markdown 列表，**每項單獨一行**：

正確的多項列舉：

- 前端工程師
- 後端開發者
- 資料工程師

正確的多步驟安裝（每步驟一行，code 用三反引號 fenced block）：

1. 安裝套件：
\`\`\`bash
npm install foo
\`\`\`

2. 初始化：
\`\`\`bash
npx foo init
\`\`\`

3. 啟動：
\`\`\`bash
npm run dev
\`\`\`

錯誤（擠成一行 + 用單反引號包多行 code）：

1. 安裝：\`bash npm install foo\` 2. 初始化：\`npx foo init\`

【關鍵規則】
- 多行程式碼**永遠用三反引號 fenced block**（\`\`\`bash...\`\`\`），**禁止**用單反引號 \`...\` 包多行內容
- 列表項目之間要視覺上分行（按 enter 換行），**不要**在文字裡寫 "\\n" 或 "\\\\n" 這種逃脫字元給使用者看到
- 適用欄位：use_cases、alternatives、pairs_with、final_advice、target_user、details[].body、install、example

【評分標準（皆為 1-10 整數）】
- practicality 實用性：能否解決實際問題
- learning_value 學習價值：值不值得花時間研究
- ease_of_use 上手難度：文檔品質、新手友善程度（分數越高越容易）
- maintenance 維護健康度：更新頻率、Issue 回應狀況
- reliability 長期可靠度：停更風險、背後團隊穩定性
- relevance 相關性：與一般開發者工作場景的契合度

⚠️ 再次提醒：所有 string 欄位必須是繁體中文，禁止英文段落。`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overview: {
      type: "object",
      properties: {
        one_liner: {
          type: "string",
          description: "繁體中文一句話描述。單句，不需 markdown。",
        },
        problem: {
          type: "string",
          description:
            "繁體中文 markdown。3 個以上痛點時用編號列表（1. 2. 3.），每項換行。",
        },
        target_user: {
          type: "string",
          description:
            "繁體中文 markdown。3 種以上使用者時用 bullet list（每行 - 開頭，項目間換行，不要用『、』串接）。",
        },
      },
      required: ["one_liner", "problem", "target_user"],
    },
    how_to_use: {
      type: "object",
      properties: {
        install: {
          type: "string",
          description:
            "繁體中文 markdown。多步驟用編號列表（1. 2. 3.），每步驟單獨一行。指令必須用三反引號 fenced code block 包裹（```bash 開頭, ``` 結尾），絕對禁止用單反引號 ` 包多行內容。",
        },
        example: {
          type: "string",
          description:
            "繁體中文 markdown。所有多行程式碼都用三反引號 fenced code block 包裹（```ts/```js/```bash 開頭, ``` 結尾），絕對禁止用單反引號 ` 包多行。",
        },
        use_cases: {
          type: "string",
          description:
            "繁體中文 markdown。3 個以上場景時用編號列表（1. 2. 3.），每項單獨一行。",
        },
      },
      required: ["install", "example", "use_cases"],
    },
    scores: {
      type: "object",
      properties: {
        practicality: { type: "integer", minimum: 1, maximum: 10 },
        learning_value: { type: "integer", minimum: 1, maximum: 10 },
        ease_of_use: { type: "integer", minimum: 1, maximum: 10 },
        maintenance: { type: "integer", minimum: 1, maximum: 10 },
        reliability: { type: "integer", minimum: 1, maximum: 10 },
        relevance: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: [
        "practicality",
        "learning_value",
        "ease_of_use",
        "maintenance",
        "reliability",
        "relevance",
      ],
    },
    supplement: {
      type: "object",
      properties: {
        alternatives: {
          type: "string",
          description:
            "繁體中文 markdown。3 個以上替代工具時用 bullet list（每行 - 開頭，項目間換行）。",
        },
        pairs_with: {
          type: "string",
          description:
            "繁體中文 markdown。3 個以上搭配工具時用 bullet list（每行 - 開頭，項目間換行）。",
        },
        final_advice: {
          type: "string",
          description:
            "繁體中文 markdown。多項建議時用 bullet 或編號列表，每項單獨一行。",
        },
      },
      required: ["alternatives", "pairs_with", "final_advice"],
    },
    details: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "繁體中文短名詞片語（噱頭名稱、API 名、Skill 名等）。",
          },
          body: {
            type: "string",
            description:
              "**精簡 60-120 字**繁體中文 markdown。重點是「這項是什麼、何時用」，不要長篇大論。指令/程式碼用三反引號 fenced block 包裹，禁止單反引號包多行。列舉項目時每項單獨一行。",
          },
        },
        required: ["title", "body"],
      },
    },
  },
  required: ["overview", "how_to_use", "scores", "supplement", "details"],
};

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function extractRelevantLinks(
  readme: string,
  repoFullName: string,
): Promise<string[]> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const prompt = `你會收到一份 GitHub 專案的 README。判斷這個 README 是否完整描述了專案的安裝、使用、功能。如果 README 簡略、有大量「請見官網」「see docs」這類引導，請從 README 中找出最多 3 條值得跟進的官方連結，回傳純 URL 字串陣列。

優先選擇：
- 官方文件首頁、quickstart、getting started
- 官方產品/公司網站
- API reference / 完整使用指南

避免選擇：
- github.com 內部連結（已抓 README）
- 社群（Twitter / X / Discord / YouTube / LinkedIn）
- npm 套件頁
- 第三方 blog / 教學文

如果 README 已經內容完整、不需要外部資料（例如 awesome-* 清單、README 已含完整安裝跟範例），直接回傳空陣列 []。
寧可少選也不亂選。

專案：${repoFullName}

README：
---
${readme.slice(0, MAX_README_CHARS)}
---`;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              links: {
                type: "array",
                maxItems: 3,
                items: { type: "string" },
              },
            },
            required: ["links"],
          },
          temperature: 0.1,
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[phase1] Gemini ${res.status}, fall back to no external content`);
      return [];
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return [];
    const parsed = JSON.parse(text) as { links?: unknown };
    const raw = Array.isArray(parsed.links) ? parsed.links : [];
    const strs = raw.filter((u): u is string => typeof u === "string");
    return filterRelevantLinks(strs);
  } catch (e) {
    console.warn(`[phase1] failed, falling back: ${(e as Error).message}`);
    return [];
  }
}

export async function analyzeRepo(
  readme: string,
  repoFullName: string,
  external: ExternalContent[] = [],
): Promise<AnalysisData> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY 未設定，請複製 .env.example 為 .env 並填入金鑰（從 https://aistudio.google.com 取得）",
    );
  }

  const truncated = readme.slice(0, MAX_README_CHARS);

  const externalSection =
    external.length > 0
      ? `\n\n以下是 README 中提到的外部官方文件內容（從相關連結抓取，請優先使用這些實際資料而非你的訓練記憶）：\n\n${external
          .map(
            (e) => `========== ${e.url} ==========\n${e.content}`,
          )
          .join("\n\n")}`
      : "";

  const fullPrompt = `${SYSTEM_PROMPT}

===

專案：${repoFullName}

以下是該專案 README 的原文內容（可能含 r.jina.ai 抓取後的格式）：

---
${truncated}
---${externalSection}

請依照上方規則產生 JSON 評估報告。**所有 string 欄位的內容必須使用繁體中文**，即使 README 或外部文件是英文也一樣。${
    external.length > 0
      ? "\n安裝方式、使用範例、詳細內容等欄位請以**外部官方文件**為主要依據，README 只是入口。"
      : ""
  }`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API 錯誤 ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const json = (await res.json()) as GeminiResponse;

  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini 拒絕請求（${json.promptFeedback.blockReason}）`);
  }
  const candidate = json.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini 回傳沒有候選結果：${JSON.stringify(json).slice(0, 300)}`);
  }
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini 異常終止（finishReason=${candidate.finishReason}）`);
  }
  const text = candidate.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini 回傳內容為空");
  }

  let parsed: AnalysisData;
  try {
    parsed = JSON.parse(text) as AnalysisData;
  } catch (e) {
    throw new Error(
      `JSON 解析失敗：${(e as Error).message}\n原始片段：${text.slice(0, 500)}`,
    );
  }
  validateAnalysis(parsed);
  postProcessMarkdown(parsed);
  return parsed;
}

// 安全網 1: 模型有時會在輸出裡寫字面 "\n"（反斜線+n），讓使用者看到逃脫字元
function unescapeLiteralNewlines(text: string): string {
  if (!text) return text;
  return text.replace(/\\n/g, "\n");
}

// 安全網 2: 模型有時用單反引號包多行內容並渲染成 inline code，例如：
//   `bash\nnpm install\n`     ← lang 黏在開頭反引號後
//   `\nbash\nnpm install\n`   ← lang 在第一行內容
// 兩種都要轉成三反引號 fenced block
function fixBrokenCodeFences(text: string): string {
  if (!text) return text;
  return text.replace(
    /(?<!`)`([a-z][a-z0-9_+#-]{0,11})?[ \t]*\n([\s\S]*?)\n[ \t]*`(?!`)/gi,
    (_match, langOnOpen: string | undefined, content: string) => {
      let lang = langOnOpen ?? "";
      let body = content;
      // 如果開頭沒帶 lang，檢查內容第一行是否是 lang hint
      if (!lang) {
        const lines = body.split("\n");
        const firstLine = lines[0]?.trim() ?? "";
        if (/^[a-z][a-z0-9_+#-]{0,11}$/i.test(firstLine)) {
          lang = firstLine;
          body = lines.slice(1).join("\n");
        }
      }
      // 前後加 \n 確保 fenced block 跟周圍內容分隔乾淨
      return "\n```" + lang + "\n" + body.trim() + "\n```\n";
    },
  );
}

// 安全網 3: 模型偶爾會把「1. xxx。 2. yyy。 3. zzz」串成一行不換行
function fixInlineNumberedList(text: string): string {
  if (!text) return text;
  // Pass 0: 行首多餘空白移除（避免 markdown 把 "  2. xxx" 解成段落延續）
  let result = text.replace(/^[ \t]+(\d+\.\s)/gm, "$1");
  // Pass 1: 標點符號 + 數字. 之間補換行（最安全）
  result = result.replace(
    /([。.！!？?：:；;])[ \t]*(\d+\.\s)/g,
    "$1\n$2",
  );
  // Pass 2: 單行內出現 2 個以上「N. 」就拆行（沒標點時的兜底）
  result = result
    .split("\n")
    .map((line) => {
      const matches = [...line.matchAll(/(\d+\.)\s/g)];
      if (matches.length < 2) return line;
      const pieces: string[] = [];
      let last = 0;
      matches.forEach((m, i) => {
        if (i === 0 || m.index === undefined) return;
        pieces.push(line.slice(last, m.index).trimEnd());
        last = m.index;
      });
      pieces.push(line.slice(last));
      return pieces.join("\n");
    })
    .join("\n");
  return result;
}

function cleanMarkdown(text: string): string {
  let r = unescapeLiteralNewlines(text);
  r = fixBrokenCodeFences(r);
  r = fixInlineNumberedList(r);
  // 收斂連續 3+ 個換行為 2 個（避免清洗後產生過大空白）
  r = r.replace(/\n{3,}/g, "\n\n");
  return r;
}

function postProcessMarkdown(data: AnalysisData): void {
  data.overview.problem = cleanMarkdown(data.overview.problem);
  data.overview.target_user = cleanMarkdown(data.overview.target_user);
  data.how_to_use.install = cleanMarkdown(data.how_to_use.install);
  data.how_to_use.example = cleanMarkdown(data.how_to_use.example);
  data.how_to_use.use_cases = cleanMarkdown(data.how_to_use.use_cases);
  data.supplement.alternatives = cleanMarkdown(data.supplement.alternatives);
  data.supplement.pairs_with = cleanMarkdown(data.supplement.pairs_with);
  data.supplement.final_advice = cleanMarkdown(data.supplement.final_advice);
  if (data.details) {
    for (const item of data.details) {
      item.body = cleanMarkdown(item.body);
    }
  }
}

function validateAnalysis(data: AnalysisData): void {
  const required = ["overview", "how_to_use", "scores", "supplement"] as const;
  for (const k of required) {
    if (!data[k]) throw new Error(`分析結果缺少欄位：${k}`);
  }
  const scoreKeys = [
    "practicality",
    "learning_value",
    "ease_of_use",
    "maintenance",
    "reliability",
    "relevance",
  ] as const;
  for (const k of scoreKeys) {
    const v = data.scores[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 10) {
      throw new Error(`scores.${k} 不合法：${v}`);
    }
    data.scores[k] = Math.round(v);
  }
  if (data.details !== undefined) {
    if (!Array.isArray(data.details)) {
      throw new Error("details 不是陣列");
    }
    if (data.details.length > 10) {
      data.details = data.details.slice(0, 10);
    }
    for (const item of data.details) {
      if (typeof item?.title !== "string" || typeof item?.body !== "string") {
        throw new Error("details 項目缺少 title 或 body");
      }
    }
  }
}

export function calculateTotal(scores: AnalysisData["scores"]): number {
  return (
    scores.practicality +
    scores.learning_value +
    scores.ease_of_use +
    scores.maintenance +
    scores.reliability +
    scores.relevance
  );
}
