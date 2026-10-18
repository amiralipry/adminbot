import { config } from '../config';
import type { PlatformResult } from '../types';

export class BaleService {
  private baseUrl = 'https://tapi.bale.ai/bot';

  private get token(): string {
    return config.settings.bale_bot_token.trim();
  }

  public isEnabled(): boolean {
    return config.settings.enable_bale;
  }

  public isConfigured(): boolean {
    return Boolean(this.token);
  }

  private getApiUrl(method: string): string {
    return `${this.baseUrl}${this.token}/${method}`;
  }

  public async testConnection(): Promise<PlatformResult> {
    if (!this.token) {
      return { success: false, platform: 'bale', error: 'توکن بازوی بله وارد نشده است.' };
    }

    try {
      const url = this.getApiUrl('getMe');
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json() as any;

      if (res.ok && data?.ok) {
        const username = data.result?.username || 'Unknown';
        return {
          success: true,
          platform: 'bale',
          message_id: username,
          error: undefined
        };
      }
      return {
        success: false,
        platform: 'bale',
        error: data?.description || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return { success: false, platform: 'bale', error: `خطا در ارتباط با بله: ${err.message}` };
    }
  }

  public async sendText(text: string, targetChannel: string): Promise<PlatformResult> {
    if (!this.isEnabled()) return { success: false, platform: 'bale', error: 'ارسال به بله غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'bale', error: 'توکن بله تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'bale', error: 'کانال مقصد بله مشخص نشده است.' };

    try {
      const url = this.getApiUrl('sendMessage');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChannel, text }),
        signal: AbortSignal.timeout(20000)
      });
      const data = await res.json() as any;

      if (res.ok && data?.ok) {
        return {
          success: true,
          platform: 'bale',
          channel: targetChannel,
          message_id: data.result?.message_id
        };
      }
      return {
        success: false,
        platform: 'bale',
        channel: targetChannel,
        error: `پاسخ بله: ${data?.description || res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        platform: 'bale',
        channel: targetChannel,
        error: `خطا در ارسال پیام به بله: ${err.message}`
      };
    }
  }

  public async sendMedia(
    mediaType: string,
    fileData: Blob | Uint8Array | ArrayBuffer,
    fileName: string,
    caption?: string,
    targetChannel?: string
  ): Promise<PlatformResult> {
    if (!this.isEnabled()) return { success: false, platform: 'bale', error: 'ارسال به بله غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'bale', error: 'توکن بله تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'bale', error: 'کانال مقصد بله مشخص نشده است.' };

    const methodMap: Record<string, [string, string]> = {
      photo: ['sendPhoto', 'photo'],
      video: ['sendVideo', 'video'],
      document: ['sendDocument', 'document'],
      voice: ['sendVoice', 'voice'],
      audio: ['sendAudio', 'audio'],
      animation: ['sendAnimation', 'animation']
    };

    const [method, fieldName] = methodMap[mediaType] || ['sendDocument', 'document'];
    const url = this.getApiUrl(method);

    try {
      const formData = new FormData();
      formData.append('chat_id', targetChannel);

      const blob = fileData instanceof Blob ? fileData : new Blob([fileData]);
      formData.append(fieldName, blob, fileName);

      if (caption) {
        formData.append('caption', caption);
      }

      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000)
      });
      const data = await res.json() as any;

      if (res.ok && data?.ok) {
        return {
          success: true,
          platform: 'bale',
          channel: targetChannel,
          message_id: data.result?.message_id
        };
      }
      return {
        success: false,
        platform: 'bale',
        channel: targetChannel,
        error: `پاسخ بله: ${data?.description || res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        platform: 'bale',
        channel: targetChannel,
        error: `خطا در ارسال مدیا به بله: ${err.message}`
      };
    }
  }
}

export const baleService = new BaleService();
