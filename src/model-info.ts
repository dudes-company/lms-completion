
import { getConfig } from './config'; // assuming this file is config.ts

interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
  max_tokens?: number;        // ← this is what we want
  context_length?: number;    // ← some models report this instead
}

let cachedModelInfo: { maxChars: number; fetchedAt: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds – model rarely changes

export async function getModelMaxChars(): Promise<number> {
  // Return cached value if recent
  if (cachedModelInfo && Date.now() - cachedModelInfo.fetchedAt < CACHE_TTL) {
    return cachedModelInfo.maxChars;
  }

  const config = getConfig();
  const endpoint = config.endpoint;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${endpoint}/v1/models`, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data:any = await res.json();
    const models: LMStudioModel[] = data.data || [];

    // Find the currently loaded model (LM Studio marks it or it's the only one)
    const loadedModel = models.find(m => 
      m.id.toLowerCase() === config.model.toLowerCase() ||
      m.id.includes(config.model.split(':')[0])
    ) || models[0]; // fallback to first

    if (!loadedModel) throw new Error('No models returned');

    // Extract real context length
    const maxTokens = loadedModel.context_length || loadedModel.max_tokens || 8192;
    const safeChars = Math.floor(maxTokens * 3.6 * 0.75); // ~75% headroom

    cachedModelInfo = {
      maxChars: safeChars,
      fetchedAt: Date.now()
    };

    console.log(`lmstudio: detected model context → ${maxTokens} tokens (~${safeChars} chars)`);
    return safeChars;

  } catch (err) {
    console.warn('lmstudio: failed to fetch model info, using fallback', err);
    // Fallback to your old static table or safe default
    return fallbackModelMaxChars();
  }
}

// Keep your old static version as fallback
function fallbackModelMaxChars(): number {
  const model = getConfig().model.toLowerCase();
  const map: Record<string, number> = {
    'phi-3': 420000,
    'llama-3.1': 420000,
    'deepseek': 110000,
    'mixtral': 110000,
    'codellama:34b': 58000,
    'codellama': 58000,
    'wizardcoder': 58000,
    'gemma': 28000,
    'mistral': 28000,
    'llama-3': 28000,
  };

  for (const [key, chars] of Object.entries(map)) {
    if (model.includes(key)) return Math.floor(chars * 0.7);
  }
  return 20000; // safe default
}