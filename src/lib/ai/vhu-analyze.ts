import 'server-only';
import { z } from 'zod';
import { IT_CATEGORY_NAMES } from '@/lib/vhu/types';

// ============================================================
// Structured AI output schema (§9.4 / §9.5 of the spec)
// ============================================================

const PrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export const AiAnalysisSchema = z.object({
  summary: z.string().min(1).max(1000),
  category: z.string().min(1).max(200),
  suggestedPriority: PrioritySchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(1000),
  suggestedDepartment: z.string().min(1).max(200).optional(),
  suggestedActions: z.array(z.string().min(1).max(300)).max(10).default([]),
});

export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;

// Priority label used by the AI JSON contract (LOW/MEDIUM/HIGH/URGENT) <->
// the Postgres `priority_level` enum reused across the app (low/medium/high/critical).
export const AI_PRIORITY_TO_DB: Record<z.infer<typeof PrioritySchema>, 'low' | 'medium' | 'high' | 'critical'> = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'critical',
};

export type AnalyzeTicketInput = {
  title: string;
  description: string;
  location?: string | null;
  deviceName?: string | null;
};

export type AnalyzeTicketResult =
  | { ok: true; data: AiAnalysis; simulated: boolean }
  | { ok: false; error: string };

const SYSTEM_PROMPT = `Bạn là trợ lý AI phân loại yêu cầu hỗ trợ CNTT cho một trường đại học tại Việt Nam.
Nhiệm vụ: đọc tiêu đề và mô tả yêu cầu, sau đó trả về DUY NHẤT một đối tượng JSON (không kèm văn bản khác, không dùng markdown code fence) đúng theo cấu trúc:
{
  "summary": string,            // tóm tắt 1-3 câu bằng tiếng Việt
  "category": string,           // MỘT trong các danh mục sau: ${IT_CATEGORY_NAMES.join(', ')}
  "suggestedPriority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  "confidence": number,         // 0 đến 1
  "reason": string,             // lý do ngắn gọn bằng tiếng Việt
  "suggestedDepartment": string, // bộ phận phụ trách phù hợp nhất
  "suggestedActions": string[]  // 2-5 bước xử lý ban đầu đề xuất cho nhân viên, tiếng Việt
}
Quy tắc mức ưu tiên:
- LOW: không ảnh hưởng trực tiếp đến công việc hiện tại.
- MEDIUM: ảnh hưởng một người nhưng có giải pháp tạm thời.
- HIGH: ảnh hưởng lớp học, phòng ban hoặc nhiều người.
- URGENT: ảnh hưởng kỳ thi, sự kiện quan trọng, an toàn thông tin hoặc toàn hệ thống.
Chỉ trả JSON, không giải thích thêm.`;

function buildUserPrompt(input: AnalyzeTicketInput): string {
  const lines = [
    `Tiêu đề: ${input.title}`,
    `Mô tả: ${input.description}`,
  ];
  if (input.location) lines.push(`Địa điểm: ${input.location}`);
  if (input.deviceName) lines.push(`Thiết bị: ${input.deviceName}`);
  return lines.join('\n');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

async function callGemini(apiKey: string, model: string, timeoutMs: number, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini API lỗi (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini không trả về nội dung.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAi(apiKey: string, model: string, timeoutMs: number, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI API lỗi (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI không trả về nội dung.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic heuristic used when AI_SIMULATION_MODE=true or no API key is configured. */
function simulateAnalysis(input: AnalyzeTicketInput): AiAnalysis {
  const text = `${input.title} ${input.description}`.toLowerCase();

  const categoryRules: Array<[RegExp, string, string]> = [
    [/wifi|internet|mạng|đường truyền|kết nối/, 'Mạng Internet', 'Phòng Hạ tầng mạng'],
    [/máy chiếu|projector/, 'Máy chiếu', 'Phòng Thiết bị - Phòng học'],
    [/máy in|photocopy/, 'Máy in', 'Phòng Thiết bị - Phòng học'],
    [/email|hộp thư|mail/, 'Email trường', 'Phòng Quản trị hệ thống'],
    [/điểm|lms|đào tạo|học phần/, 'Phần mềm đào tạo', 'Phòng Quản trị hệ thống'],
    [/cổng thông tin|thời khóa biểu/, 'Cổng thông tin sinh viên', 'Phòng Quản trị hệ thống'],
    [/tài khoản|mật khẩu|đăng nhập/, 'Tài khoản sinh viên', 'Phòng Quản trị hệ thống'],
    [/virus|bảo mật|truy cập bất thường|an toàn thông tin/, 'An toàn thông tin', 'Phòng Quản trị hệ thống'],
    [/cài đặt|phần mềm/, 'Cài đặt phần mềm', 'Phòng Công nghệ thông tin'],
    [/máy tính|pc|màn hình|bàn phím|chuột/, 'Máy tính phòng học', 'Phòng Thiết bị - Phòng học'],
    [/loa|âm thanh|điều hòa|thiết bị/, 'Thiết bị phòng học', 'Phòng Thiết bị - Phòng học'],
  ];

  let category = 'Yêu cầu khác';
  let department = 'Phòng Công nghệ thông tin';
  for (const [re, cat, dept] of categoryRules) {
    if (re.test(text)) {
      category = cat;
      department = dept;
      break;
    }
  }

  let priority: z.infer<typeof PrioritySchema> = 'MEDIUM';
  let reason = 'Ảnh hưởng một người dùng, có thể xử lý theo quy trình thông thường (chế độ mô phỏng).';
  if (/thi\b|kỳ thi|toàn bộ|cả phòng|cả lớp|không truy cập được hệ thống|an toàn thông tin|virus|truy cập bất thường/.test(text)) {
    priority = 'URGENT';
    reason = 'Có dấu hiệu ảnh hưởng kỳ thi, nhiều người dùng hoặc an toàn thông tin (chế độ mô phỏng).';
  } else if (/phòng|lớp|nhiều người|toàn trường|toàn khu/.test(text)) {
    priority = 'HIGH';
    reason = 'Ảnh hưởng một phòng/khu vực (chế độ mô phỏng).';
  } else if (/gợi ý|góp ý|đề xuất|nhỏ/.test(text)) {
    priority = 'LOW';
    reason = 'Không ảnh hưởng trực tiếp công việc hiện tại (chế độ mô phỏng).';
  }

  const summary = input.description.length > 160
    ? `${input.description.slice(0, 157).trim()}...`
    : input.description;

  return {
    summary: summary || input.title,
    category,
    suggestedPriority: priority,
    confidence: 0.6,
    reason,
    suggestedDepartment: department,
    suggestedActions: [
      'Xác minh lại thông tin sự cố với người dùng',
      `Kiểm tra thực tế tại ${input.location || 'vị trí được báo cáo'}`,
      'Ghi nhận kết quả kiểm tra và cập nhật trạng thái ticket',
    ],
  };
}

/**
 * Analyzes a ticket with Gemini or OpenAI (server-side only), validates the
 * structured JSON response with Zod, and falls back to a deterministic
 * simulation when AI_SIMULATION_MODE=true or no provider/API key is set.
 * Never throws — callers always get a discriminated result so ticket
 * creation is never blocked by an AI failure (§9.5 of the spec).
 */
export async function analyzeTicketWithAi(input: AnalyzeTicketInput): Promise<AnalyzeTicketResult> {
  const simulationMode = process.env.AI_SIMULATION_MODE === 'true';
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 20000);

  const hasRealProvider = (provider === 'gemini' && !!geminiKey) || (provider === 'openai' && !!openaiKey);

  if (simulationMode || !hasRealProvider) {
    try {
      return { ok: true, data: AiAnalysisSchema.parse(simulateAnalysis(input)), simulated: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Lỗi mô phỏng AI không xác định.' };
    }
  }

  try {
    const userPrompt = buildUserPrompt(input);
    const raw = provider === 'openai'
      ? await callOpenAi(openaiKey!, process.env.OPENAI_MODEL || 'gpt-4o-mini', timeoutMs, userPrompt)
      : await callGemini(geminiKey!, process.env.GEMINI_MODEL || 'gemini-2.0-flash', timeoutMs, userPrompt);

    const parsed = AiAnalysisSchema.safeParse(extractJson(raw));
    if (!parsed.success) {
      return { ok: false, error: 'AI trả về dữ liệu không đúng định dạng mong đợi.' };
    }
    // Guard against an unrecognized category leaking through — fall back to "Yêu cầu khác".
    const category = IT_CATEGORY_NAMES.includes(parsed.data.category as (typeof IT_CATEGORY_NAMES)[number])
      ? parsed.data.category
      : 'Yêu cầu khác';

    return { ok: true, data: { ...parsed.data, category }, simulated: false };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'AI không phản hồi kịp thời (timeout).' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Lỗi gọi AI không xác định.' };
  }
}
