import type { AnalysisData } from "./db.ts";

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
    * body: 200-500 字繁體中文 markdown，可含 \`\`\`code block\`\`\`、列表、連結
  如果 README 沒有可拆分的原子內容（例如純粹是專案介紹），回傳空陣列 []。
  不要為了湊數而拆，寧可少一點也要每條都有實際資訊。

【列表格式規則（很重要）】
以下情況**必須**用 markdown bullet list（每行以 `- ` 開頭），**不要**寫成「A、B、C」這種逗號串接的段落：
- target_user 列舉多種目標使用者時（例如：前端工程師、後端開發者、學生）
- use_cases 列舉多個使用情境時
- alternatives 列舉多個替代工具時
- pairs_with 列舉多個搭配工具時
- final_advice 包含多個獨立建議或行動步驟時
- details[].body 列舉指令、API、Skills、子功能等時

判斷標準：**內容有 3 個以上獨立項目時，一律用 bullet list**。1-2 個項目可以用段落。
指令、code snippet 一律用 \`\`\`bash 或 \`\`\`js 等 code block 包裹，不要散在段落裡。

【install / example 多步驟格式（很重要）】
**單一指令**直接用 code block：
\`\`\`bash
npm install foo
\`\`\`

**多步驟必須用 markdown 編號列表，每一步單獨一行（步驟之間用換行 \\n 分隔）**，例如：

1. 安裝套件：
   \`\`\`bash
   npm install foo
   \`\`\`
2. 初始化：
   \`\`\`bash
   npx foo init
   \`\`\`
3. 設定環境變數：複製 \`.env.example\` 為 \`.env\` 並填入金鑰
4. 啟動：
   \`\`\`bash
   npx foo start
   \`\`\`

❌ 禁止把多步驟塞成單行（例如「1. 安裝… 2. 初始化… 3. 設定…」全擠在一段）。每個編號後面**必須**有換行。

【關於 JSON 字串中的換行】
你輸出的是 JSON，markdown 的換行在 JSON 字串裡必須是字元 \`\\n\`（反斜線 + n）。例如：

正確（JSON 字串包含 \\n escape）：
"use_cases": "1. 平行化代理：同時跑多個 AI agent\\n2. 程式碼審查：讓 agent 在沙盒中實作\\n3. 自動化 Git 流程：管理分支與提交"

錯誤（用空格串起來，沒換行）：
"use_cases": "1. 平行化代理：同時跑多個 AI agent 2. 程式碼審查：讓 agent 實作 3. 自動化 Git 流程"

對 use_cases、alternatives、pairs_with、final_advice、target_user、details[].body、install、example 這些欄位，**列表項目之間必須用 \\n 分隔**，不可省略換行。

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
            "繁體中文 markdown 內容。3 個以上痛點時用 markdown 編號列表（1. 2. 3.），每項用 \\n 分隔。",
        },
        target_user: {
          type: "string",
          description:
            "繁體中文 markdown 內容。3 種以上使用者時必須用 bullet list（每行 - 開頭，用 \\n 分隔）。例：- 前端工程師\\n- 後端開發者\\n- 資料工程師",
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
            "繁體中文 markdown。指令必須用**三個反引號的 fenced code block**包裹（例：\\n```bash\\nnpm install foo\\n```\\n）。**嚴禁使用單一反引號的 inline code**（如 `npm install foo`）。多步驟用 1. 2. 3. 編號列表，步驟間用 \\n 分隔。",
        },
        example: {
          type: "string",
          description:
            "繁體中文 markdown。程式碼必須用**三個反引號的 fenced code block**包裹（例：\\n```ts\\nimport { foo } from 'bar';\\nfoo();\\n```\\n）。**嚴禁把多行程式碼寫成單一反引號的 inline code**。",
        },
        use_cases: {
          type: "string",
          description:
            "繁體中文 markdown 內容。3 個以上場景時必須用編號列表（1. 2. 3.），每項用 \\n 分隔。",
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
            "繁體中文 markdown 內容。3 個以上替代工具時必須用 bullet list（- 開頭，\\n 分隔）。",
        },
        pairs_with: {
          type: "string",
          description:
            "繁體中文 markdown 內容。3 個以上搭配工具時必須用 bullet list（- 開頭，\\n 分隔）。",
        },
        final_advice: {
          type: "string",
          description:
            "繁體中文 markdown 內容。多項建議時用 bullet 或編號列表，項目間用 \\n 分隔。",
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
              "繁體中文 markdown 200-500 字。指令/程式碼必須用**三個反引號的 fenced code block**包裹（```bash ... ``` 或 ```ts ... ```），嚴禁用單一反引號 inline。列舉 3 項以上時用 - bullet 或 1. 編號，每項 \\n 分隔。",
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

export async function analyzeRepo(
  readme: string,
  repoFullName: string,
): Promise<AnalysisData> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY 未設定，請複製 .env.example 為 .env 並填入金鑰（從 https://aistudio.google.com 取得）",
    );
  }

  const truncated = readme.slice(0, MAX_README_CHARS);
  const fullPrompt = `${SYSTEM_PROMPT}

===

專案：${repoFullName}

以下是該專案 README 的原文內容（可能含 r.jina.ai 抓取後的格式）：

---
${truncated}
---

請依照上方規則產生 JSON 評估報告。**所有 string 欄位的內容必須使用繁體中文**，即使 README 是英文也一樣。`;

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

// 安全網：模型偶爾會把「1. xxx。 2. yyy。 3. zzz」串成一行不換行
function fixInlineNumberedList(text: string): string {
  if (!text) return text;
  // Pass 1: 標點符號 + 數字. 之間補換行（最安全）
  let result = text.replace(
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

function postProcessMarkdown(data: AnalysisData): void {
  data.overview.problem = fixInlineNumberedList(data.overview.problem);
  data.overview.target_user = fixInlineNumberedList(data.overview.target_user);
  data.how_to_use.install = fixInlineNumberedList(data.how_to_use.install);
  data.how_to_use.example = fixInlineNumberedList(data.how_to_use.example);
  data.how_to_use.use_cases = fixInlineNumberedList(data.how_to_use.use_cases);
  data.supplement.alternatives = fixInlineNumberedList(
    data.supplement.alternatives,
  );
  data.supplement.pairs_with = fixInlineNumberedList(data.supplement.pairs_with);
  data.supplement.final_advice = fixInlineNumberedList(
    data.supplement.final_advice,
  );
  if (data.details) {
    for (const item of data.details) {
      item.body = fixInlineNumberedList(item.body);
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
