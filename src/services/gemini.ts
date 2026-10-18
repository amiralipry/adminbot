import { config } from '../config';

export class GeminiService {
  private static instance: GeminiService;
  private readonly models = [
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.8-flash'
  ];

  // Store conversation history per chat (last 10 turns per chatId)
  private chatHistories = new Map<string, Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>>();

  private constructor() {}

  public static getInstance(): GeminiService {
    if (!GeminiService.instance) {
      GeminiService.instance = new GeminiService();
    }
    return GeminiService.instance;
  }

  public isEnabled(): boolean {
    return Boolean(config.settings.gemini_enabled && config.settings.gemini_api_key?.trim());
  }

  public clearHistory(chatId?: string | number): void {
    if (chatId) {
      this.chatHistories.delete(String(chatId));
    } else {
      this.chatHistories.clear();
    }
  }

  private getApiKeys(): string[] {
    const keys: string[] = [];
    const primary = config.settings.gemini_api_key?.trim();
    const backup = config.settings.gemini_backup_api_key?.trim();
    if (primary) keys.push(primary);
    if (backup && backup !== primary) keys.push(backup);
    return keys;
  }

  private getActiveProvider(): 'auto' | 'gemini' | 'gemini_backup' | 'gapgpt' | 'gapgpt_gemma' | 'gpt_6_luna' {
    return config.settings.ai_provider || 'auto';
  }

  public getProviderDisplayName(): string {
    const p = this.getActiveProvider();
    if (p === 'gemini') return 'گوگل جمینای (اصلی)';
    if (p === 'gemini_backup') return 'گوگل جمینای (پشتیبان)';
    if (p === 'gapgpt') return 'گپ جی‌پی‌تی (GPT-4o)';
    if (p === 'gapgpt_gemma') return 'گپ جما (Gemma 26B A4B)';
    if (p === 'gpt_6_luna') return 'اوپن‌ای‌آی لونا (GPT-6 Luna)';
    return 'خودکار هوشمند (Auto Failover)';
  }

  /**
   * Call GapGPT OpenAI-compatible API for text generation
   */
  private async callGapGpt(
    messages: Array<{ role: string; content: string }>,
    preferredModel?: string
  ): Promise<string | null> {
    const key = config.settings.gapgpt_api_key?.trim();
    if (!key) return null;

    const models = preferredModel
      ? [preferredModel, 'gapgpt-gemma-26b-a4b', 'gpt-4o-mini', 'gpt-4o']
      : ['gapgpt-gemma-26b-a4b', 'gpt-4o-mini', 'gpt-4o'];

    for (const model of models) {
      try {
        const res = await fetch('https://api.gapgpt.app/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.8,
            max_tokens: 1000
          }),
          signal: AbortSignal.timeout(30000)
        });

        const data = await res.json() as any;
        if (res.ok && data?.choices?.[0]?.message?.content) {
          return data.choices[0].message.content.trim();
        }
        console.warn(`[GapGPT] Model ${model} returned error:`, data?.error?.message || res.status);
      } catch (err: any) {
        console.warn(`[GapGPT] Model ${model} fetch failed:`, err?.message || String(err));
      }
    }
    return null;
  }

  public async generateReply(
    userMessage: string,
    context?: {
      chatId?: string | number;
      senderName?: string;
      replyToText?: string;
      channelSummary?: string;
    }
  ): Promise<string> {
    const basePrompt = config.settings.gemini_system_prompt ||
      'نام شما «ادمین سیکاپ» است. شما هوش مصنوعی دستیار صمیمی و خودمانی در گروه سیکاپ هستید. پاسخ‌ها را بسیار کوتاه، طبیعی و در ۱ الی ۳ خط بدهید. اصلاً وظایف، فلسفه حضور، شعارها یا کانال‌ها را در پیام‌ها تکرار نکنید مگر اینکه دقیقاً سوال شده باشد.';

    let promptText = userMessage.trim();
    const contextPrefixes: string[] = [];

    if (context?.channelSummary) {
      contextPrefixes.push(`[اطلاعات آخرین آمار محتوای کانال‌ها:\n${context.channelSummary}]`);
    }

    if (context?.replyToText) {
      contextPrefixes.push(`[پیامی که کاربر در پاسخ به آن پیام فرستاده:\n"${context.replyToText.slice(0, 300)}"]`);
    }

    if (context?.senderName) {
      contextPrefixes.push(`کاربر: ${context.senderName}`);
    }

    if (contextPrefixes.length > 0) {
      promptText = `${contextPrefixes.join('\n')}\n${promptText}`;
    }

    const chatIdStr = context?.chatId ? String(context.chatId) : 'default';
    const history = this.chatHistories.get(chatIdStr) || [];
    const provider = this.getActiveProvider();

    // 1. If provider is explicitly set to GapGPT models (GPT-4o, Gemma, or GPT-6 Luna)
    if (provider === 'gapgpt' || provider === 'gapgpt_gemma' || provider === 'gpt_6_luna') {
      let preferredModel = 'gpt-4o-mini';
      if (provider === 'gapgpt_gemma') preferredModel = 'gapgpt-gemma-26b-a4b';
      else if (provider === 'gpt_6_luna') preferredModel = 'gpt-6-luna';

      const gptMessages = [
        { role: 'system', content: basePrompt },
        ...history.map(h => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.parts[0].text
        })),
        { role: 'user', content: promptText }
      ];

      const gapGptReply = await this.callGapGpt(gptMessages, preferredModel);
      if (gapGptReply) {
        const newHistory = [...history, { role: 'user' as const, parts: [{ text: promptText }] }, {
          role: 'model' as const,
          parts: [{ text: gapGptReply }]
        }];
        this.chatHistories.set(chatIdStr, newHistory.slice(-20));
        return gapGptReply;
      }
      console.warn(`[GeminiService] ${provider} failed, falling back to Gemini...`);
    }

    // 2. Prepare keys for Gemini based on provider
    let keysToTry: string[] = [];
    if (provider === 'gemini') {
      const k = config.settings.gemini_api_key?.trim();
      if (k) keysToTry.push(k);
    } else if (provider === 'gemini_backup') {
      const k = config.settings.gemini_backup_api_key?.trim();
      if (k) keysToTry.push(k);
    } else {
      // auto mode: primary then backup
      keysToTry = this.getApiKeys();
    }

    // Assemble payload for Google Gemini
    const currentTurn = {
      role: 'user' as const,
      parts: [{ text: promptText }]
    };
    const contents = [...history, currentTurn];

    const payload = {
      systemInstruction: {
        parts: [{ text: basePrompt }]
      },
      contents,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 1000,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    let lastError = '';

    for (const key of keysToTry) {
      for (const model of this.models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(25000)
          });

          const data = await res.json() as any;

          if (res.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const replyText = data.candidates[0].content.parts[0].text.trim();

            const newHistory = [...history, currentTurn, {
              role: 'model' as const,
              parts: [{ text: replyText }]
            }];
            this.chatHistories.set(chatIdStr, newHistory.slice(-20));

            return replyText;
          }

          const errMsg = data?.error?.message || `HTTP ${res.status}`;
          lastError = errMsg;
          console.warn(`[Gemini] Model ${model} with key ${key.slice(0, 8)}... error: ${errMsg}`);
        } catch (err: any) {
          lastError = err?.message || String(err);
          console.warn(`[Gemini] Model ${model} fetch failed:`, lastError);
        }
      }
    }

    // 3. If in auto mode and Gemini failed, try GapGPT as final fallback
    if (provider === 'auto' && config.settings.gapgpt_api_key?.trim()) {
      console.warn('[GeminiService] Gemini failed in auto mode, falling back to GapGPT...');
      const gptMessages = [
        { role: 'system', content: basePrompt },
        ...history.map(h => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.parts[0].text
        })),
        { role: 'user', content: promptText }
      ];
      const gapGptReply = await this.callGapGpt(gptMessages);
      if (gapGptReply) {
        const newHistory = [...history, currentTurn, {
          role: 'model' as const,
          parts: [{ text: gapGptReply }]
        }];
        this.chatHistories.set(chatIdStr, newHistory.slice(-20));
        return gapGptReply;
      }
    }

    console.error('[AI Service] All providers failed. Last error:', lastError);
    return 'قربونت برم، ارتباط با سرور هوش مصنوعی موقتاً قطع شد یا کلید نیاز به بررسی داره! یک بار دیگه امتحان کن! 😄';
  }

  /**
   * Generate image using GapGPT (qwen-image-2.1 / dall-e-3) or Pollinations Flux
   */
  public async generateImage(prompt: string): Promise<{ buffer: Buffer; format: string }> {
    const provider = this.getActiveProvider();
    const gapGptKey = config.settings.gapgpt_api_key?.trim();

    // 1. Try GapGPT models (gapgpt/qwen-image-2.1 then dall-e-3)
    if ((provider === 'gapgpt' || provider === 'auto') && gapGptKey) {
      const gapImageModels = [
        'gapgpt/qwen-image-2.1',
        'dall-e-3'
      ];

      for (const model of gapImageModels) {
        try {
          console.log(`[GapGPT Image] Generating image with model: ${model}...`);
          const res = await fetch('https://api.gapgpt.app/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${gapGptKey}`
            },
            body: JSON.stringify({
              prompt,
              model,
              size: '1024x1024'
            }),
            signal: AbortSignal.timeout(60000)
          });

          const data = await res.json() as any;

          // Check if returned direct file URL
          const fileUrl = data?.data?.[0]?.url;
          if (fileUrl) {
            console.log(`[GapGPT Image] Image ready at URL: ${fileUrl}`);
            const imgFetch = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
            if (imgFetch.ok) {
              const arr = await imgFetch.arrayBuffer();
              return {
                buffer: Buffer.from(arr),
                format: 'png'
              };
            }
          }

          // Check if returned base64
          if (data?.data?.[0]?.b64_json) {
            return {
              buffer: Buffer.from(data.data[0].b64_json, 'base64'),
              format: 'png'
            };
          }

          console.warn(`[GapGPT Image] Model ${model} returned:`, data?.error?.message || res.status);
        } catch (err: any) {
          console.warn(`[GapGPT Image] Model ${model} failed:`, err?.message || String(err));
        }
      }
    }

    // 2. Try Google Imagen 3 (if provider is gemini/backup/auto)
    let keysToTry: string[] = [];
    if (provider === 'gemini') {
      const k = config.settings.gemini_api_key?.trim();
      if (k) keysToTry.push(k);
    } else if (provider === 'gemini_backup') {
      const k = config.settings.gemini_backup_api_key?.trim();
      if (k) keysToTry.push(k);
    } else if (provider === 'auto') {
      keysToTry = this.getApiKeys();
    }

    let lastError = '';

    for (const key of keysToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: '1:1',
              outputOptions: { mimeType: 'image/jpeg' }
            }
          }),
          signal: AbortSignal.timeout(35000)
        });

        const data = await res.json() as any;
        if (res.ok && data?.predictions?.[0]?.bytesBase64Encoded) {
          return {
            buffer: Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64'),
            format: 'jpeg'
          };
        }

        const errMsg = data?.error?.message || `HTTP ${res.status}`;
        lastError = errMsg;
        console.warn(`[Imagen] returned error: ${errMsg}`);
      } catch (err: any) {
        lastError = err?.message || String(err);
        console.warn(`[Imagen] failed:`, lastError);
      }
    }

    // 3. Robust Fallback: Pollinations AI (Flux)
    console.warn('[AI Image] Using Pollinations Flux for prompt:', prompt);
    const encodedPrompt = encodeURIComponent(prompt);
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;
    const res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(35000) });
    if (!res.ok) {
      throw new Error(`خطا در تولید تصویر: ${lastError || res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      format: 'jpeg'
    };
  }

  /**
   * Transcribe audio/voice using GapGPT Whisper (gapgpt/whisper-1)
   */
  public async transcribeAudio(audioBuffer: Buffer, fileName = 'audio.mp3'): Promise<string> {
    const key = config.settings.gapgpt_api_key?.trim();
    if (!key) {
      throw new Error('کلید API گپ جی‌پی‌تی برای تبدیل صوت تنظیم نشده است.');
    }

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    formData.append('file', blob, fileName);
    formData.append('model', 'gapgpt/whisper-1');

    const res = await fetch('https://api.gapgpt.app/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`
      },
      body: formData,
      signal: AbortSignal.timeout(60000)
    });

    const data = await res.json() as any;
    if (res.ok && data?.text) {
      return data.text.trim();
    }

    throw new Error(data?.error?.message || `خطای سرور GapGPT: ${res.status}`);
  }
}

export const geminiService = GeminiService.getInstance();
