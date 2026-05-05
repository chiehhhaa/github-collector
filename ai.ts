import type { AnalysisData } from "./db.ts";

const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_README_CHARS = 50_000;

const SYSTEM_PROMPT = `你是一位資深軟體工程師，專門快速評估開源專案對開發者的價值。
你會收到一個 GitHub 專案的 README 內容，必須產生結構化評估報告。

【欄位指引】
- overview.one_liner: 一句話描述這個專案是什麼
- overview.problem: 它解決什麼痛點
- overview.target_user: 適合誰用、目標使用者
- how_to_use.install: 安裝方式，請用 markdown code block（\`\`\`bash 等）包裹指令
- how_to_use.example: 最小可用範例，請用 markdown code block 包裹
- how_to_use.use_cases: 實際上會在什麼情況下用它
- supplement.alternatives: 類似的工具有哪些
- supplement.pairs_with: 通常跟哪些工具一起用
- supplement.final_advice: 根據評分給出明確的行動建議

【評分標準（皆為 1-10 整數）】
- practicality 實用性：能否解決實際問題
- learning_value 學習價值：值不值得花時間研究
- ease_of_use 上手難度：文檔品質、新手友善程度（分數越高越容易）
- maintenance 維護健康度：更新頻率、Issue 回應狀況
- reliability 長期可靠度：停更風險、背後團隊穩定性
- relevance 相關性：與一般開發者工作場景的契合度

請使用繁體中文撰寫所有文字欄位。`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overview: {
      type: "object",
      properties: {
        one_liner: { type: "string" },
        problem: { type: "string" },
        target_user: { type: "string" },
      },
      required: ["one_liner", "problem", "target_user"],
    },
    how_to_use: {
      type: "object",
      properties: {
        install: { type: "string" },
        example: { type: "string" },
        use_cases: { type: "string" },
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
        alternatives: { type: "string" },
        pairs_with: { type: "string" },
        final_advice: { type: "string" },
      },
      required: ["alternatives", "pairs_with", "final_advice"],
    },
  },
  required: ["overview", "how_to_use", "scores", "supplement"],
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
  const userPrompt = `專案：${repoFullName}

以下是該專案 README 的原文內容（可能含 r.jina.ai 抓取後的格式）：

---
${truncated}
---`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
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
  return parsed;
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
