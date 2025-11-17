// src/config.ts
import * as vscode from 'vscode';


export interface Config {
    endpoint: string;
    model: string;
    maxTokens: number;
    temperature: number;
    timeout: number;
    retries: number;
    debounceMs: number;
    contextLines: number;
    maxFileReadChars: number;
    inlineEnabled: boolean;
}

let cachedConfig: Config;

export function getConfig(): Config {
    if (cachedConfig) { return cachedConfig; }

    const c = vscode.workspace.getConfiguration('lmstudio');
    const endpointRaw = (c.get<string>('endpoint') || 'http://127.0.0.1:1234').trim();
    const endpointBase = endpointRaw.endsWith('/') ? endpointRaw.slice(0, -1) : endpointRaw;

    cachedConfig = {
        endpoint: endpointBase,
        model: c.get<string>('model') || '',
        maxTokens: Number(c.get<number>('maxTokens') ?? 512),
        temperature: Number(c.get<number>('temperature') ?? 0.7),
        timeout: Number(c.get<number>('timeout') ?? 60000),
        retries: Number(c.get<number>('retries') ?? 1),
        debounceMs: Number(c.get<number>('debounceMs') ?? 500),
        contextLines: Number(c.get<number>('contextLines') ?? 50),
        maxFileReadChars: Number(c.get<number>('maxFileReadChars') ?? 1200),
        inlineEnabled: c?.get<boolean>("inlineEnabled") ?? false
    };

    return cachedConfig;
}

// Call this when settings change
export function refreshConfig() {
    cachedConfig = null as any; // force reload next getConfig()
    console.log('lmstudio: config refreshed');
}