export type Provider = 'deepseek' | 'qwen' | 'openai' | 'custom';

export interface LLMSettings {
  provider: Provider;
  apiKey: string;
  apiEndpoint: string;
  model: string;
}

export interface ProviderDef {
  name: string;
  endpoint: string;
  models: string[];
  placeholder?: string;
}

export const PROVIDERS: Record<Provider, ProviderDef> = {
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  qwen: {
    name: '通义千问 (Qwen)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
  },
  openai: {
    name: 'OpenAI / 兼容接口',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  },
  custom: {
    name: '自定义端点',
    endpoint: '',
    models: [],
    placeholder: 'http://localhost:11434/v1/chat/completions',
  },
};

const KEY = 'im_settings_v1';

export function loadSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LLMSettings>;
      return {
        provider: (parsed.provider as Provider) ?? 'deepseek',
        apiKey: parsed.apiKey ?? '',
        apiEndpoint: parsed.apiEndpoint ?? PROVIDERS.deepseek.endpoint,
        model: parsed.model ?? 'deepseek-chat',
      };
    }
  } catch {}
  return defaultSettings();
}

export function saveSettings(s: LLMSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function defaultSettings(): LLMSettings {
  return {
    provider: 'deepseek',
    apiKey: '',
    apiEndpoint: PROVIDERS.deepseek.endpoint,
    model: 'deepseek-chat',
  };
}

export function isConfigured(s: LLMSettings): boolean {
  return Boolean(s.apiKey.trim() && s.apiEndpoint.trim() && s.model.trim());
}
