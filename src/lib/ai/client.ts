'use server';

import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';

// ============================================================
// Types
// ============================================================

interface AiConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'custom';
  apiKey: string;
  model: string;
  endpointUrl?: string;
  timeout: number;
}

interface AiResponse {
  content: string;
  tokensUsed: number;
}

// ============================================================
// Configuration
// ============================================================

export async function getAiConfig(): Promise<AiConfig | null> {
  const supabase = await createServerClient();

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['ai_provider', 'ai_model', 'ai_request_timeout', 'ai_custom_endpoint_url']);

  const map = new Map(settings?.map((s) => [s.key, s.value]) ?? []);
  const dbProvider = map.get('ai_provider') ?? '';
  const dbModel = map.get('ai_model') ?? '';

  // Read API key from Supabase Vault
  const serviceClient = createServiceRoleClient();
  const { data: secrets } = await serviceClient
    .rpc('get_ai_api_key');

  let apiKey = '';
  if (secrets) {
    apiKey = typeof secrets === 'string' ? secrets : '';
  }

  // Fallback: query vault.decrypted_secrets directly
  if (!apiKey) {
    const { data: vaultRows } = await serviceClient
      .from('vault.decrypted_secrets' as string)
      .select('decrypted_secret')
      .eq('name', 'ai_api_key')
      .limit(1);

    if (vaultRows && vaultRows.length > 0) {
      apiKey = (vaultRows[0] as Record<string, string>).decrypted_secret ?? '';
    }
  }

  // DB values take precedence; env vars fill in only what is not set in DB.
  // Validation is deferred until after resolving so env vars can substitute.
  const resolvedProvider = (['openai', 'anthropic', 'gemini', 'custom'].includes(dbProvider))
    ? dbProvider as AiConfig['provider']
    : (['openai', 'anthropic', 'gemini', 'custom'].includes(process.env.AI_PROVIDER ?? '')
      ? process.env.AI_PROVIDER as AiConfig['provider']
      : null);

  // Fallback to environment variables when Vault has no key. Provider-specific
  // names (GEMINI_API_KEY / OPENAI_API_KEY, per the VHU deployment docs) are
  // tried before the generic AI_API_KEY used by the inherited admin AI config.
  if (!apiKey) {
    if (resolvedProvider === 'gemini') apiKey = process.env.GEMINI_API_KEY ?? '';
    else if (resolvedProvider === 'openai') apiKey = process.env.OPENAI_API_KEY ?? '';
  }
  if (!apiKey) apiKey = process.env.AI_API_KEY ?? '';

  if (!apiKey) return null;
  if (!resolvedProvider) return null;

  const resolvedModel = dbModel || (process.env.AI_MODEL ?? '');
  if (!resolvedModel) return null;

  const timeout = parseInt(map.get('ai_request_timeout') ?? '60', 10) || 60;
  const endpointUrl = map.get('ai_custom_endpoint_url') || process.env.AI_CUSTOM_ENDPOINT_URL || undefined;

  return {
    provider: resolvedProvider,
    apiKey,
    model: resolvedModel,
    endpointUrl,
    timeout,
  };
}

// ============================================================
// Core AI Call
// ============================================================

export async function callAi(
  systemPrompt: string,
  userPrompt: string,
  configOverride?: Partial<AiConfig>,
): Promise<AiResponse> {
  const baseConfig = await getAiConfig();
  if (!baseConfig) throw new Error('AI is not configured');

  const config = { ...baseConfig, ...configOverride };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout * 1000);

  try {
    let url: string;
    let headers: Record<string, string>;
    let body: string;

    switch (config.provider) {
      case 'openai': {
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        };
        body = JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });
        break;
      }
      case 'anthropic': {
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        };
        body = JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt },
          ],
        });
        break;
      }
      case 'gemini': {
        const model = config.model || 'gemini-2.0-flash';
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        });
        break;
      }
      case 'custom': {
        url = config.endpointUrl ?? '';
        if (!url) throw new Error('Custom endpoint URL is required');
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        };
        body = JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });
        break;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`AI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Parse response based on provider
    let content = '';
    let tokensUsed = 0;

    if (config.provider === 'anthropic') {
      content = data.content?.[0]?.text ?? '';
      tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    } else if (config.provider === 'gemini') {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      tokensUsed = (data.usageMetadata?.totalTokenCount ?? 0);
    } else {
      // OpenAI and custom (OpenAI-compatible)
      content = data.choices?.[0]?.message?.content ?? '';
      tokensUsed = data.usage?.total_tokens ?? 0;
    }

    return { content, tokensUsed };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Call AI expecting free text (not JSON). Used for suggested reply and ticket summary.
 */
export async function callAiText(
  systemPrompt: string,
  userPrompt: string,
  configOverride?: Partial<AiConfig>,
): Promise<AiResponse> {
  const baseConfig = await getAiConfig();
  if (!baseConfig) throw new Error('AI is not configured');

  const config = { ...baseConfig, ...configOverride };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout * 1000);

  try {
    let url: string;
    let headers: Record<string, string>;
    let body: string;

    switch (config.provider) {
      case 'openai': {
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        };
        body = JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5,
        });
        break;
      }
      case 'anthropic': {
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        };
        body = JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt },
          ],
        });
        break;
      }
      case 'gemini': {
        const model = config.model || 'gemini-2.0-flash';
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.5 },
        });
        break;
      }
      case 'custom': {
        url = config.endpointUrl ?? '';
        if (!url) throw new Error('Custom endpoint URL is required');
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        };
        body = JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5,
        });
        break;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`AI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    let content = '';
    let tokensUsed = 0;

    if (config.provider === 'anthropic') {
      content = data.content?.[0]?.text ?? '';
      tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    } else if (config.provider === 'gemini') {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      tokensUsed = (data.usageMetadata?.totalTokenCount ?? 0);
    } else {
      content = data.choices?.[0]?.message?.content ?? '';
      tokensUsed = data.usage?.total_tokens ?? 0;
    }

    return { content, tokensUsed };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================
// Usage Logging
// ============================================================

export async function logAiUsage(
  agentId: string | null,
  feature: string,
  tokensUsed: number,
): Promise<void> {
  const serviceClient = createServiceRoleClient();
  await serviceClient.from('ai_usage_log').insert({
    agent_id: agentId,
    feature,
    tokens_used: tokensUsed,
  });
}
