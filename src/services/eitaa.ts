import { config } from '../config';
import type { PlatformResult } from '../types';

export class EitaaService {
  private get token(): string {
    return config.settings.eitaa_token.trim();
  }

  private get apiType(): string {
    return config.settings.eitaa_api_type.trim().toLowerCase();
  }

  public isEnabled(): boolean {
    return config.settings.enable_eitaa;
  }

  public isConfigured(): boolean {
    return Boolean(this.token);
  }

  private getBaseUrl(): string {
    if (this.apiType === 'direct') {
      return `https://eitaa.com/api/${this.token}/`;
    }
    return `https://eitaayar.ir/api/${this.token}/`;
  }

  public async testConnection(): Promise<PlatformResult> {
    if (!this.token) {
      return { success: false, platform: 'eitaa', error: 'توکن ایتا وارد نشده است.' };
    }

    try {
      const url = `${this.getBaseUrl()}getMe`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await res.text();

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        return {
          success: res.ok,
          platform: 'eitaa',
          message_id: text.slice(0, 50)
        };
      }

      if (data?.status === true || data?.ok === true || res.ok) {
        return {
          success: true,
          platform: 'eitaa',
          message_id: 'Connected'
        };
      }
      return {
        success: false,
        platform: 'eitaa',
        error: data?.message || data?.description || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return { success: false, platform: 'eitaa', error: `خطا در ارتباط با ایتا: ${err.message}` };
    }
  }

  public async sendText(text: string, targetChannel: string): Promise<PlatformResult> {
    if (!this.isEnabled()) return { success: false, platform: 'eitaa', error: 'ارسال به ایتا غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'eitaa', error: 'توکن ایتا تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'eitaa', error: 'کانال مقصد ایتا مشخص نشده است.' };

    const url = `${this.getBaseUrl()}sendMessage`;

    try {
      let res: Response;
      if (this.apiType === 'direct') {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: targetChannel, text }),
          signal: AbortSignal.timeout(20000)
        });
      } else {
        const form = new FormData();
        form.append('chat_id', targetChannel);
        form.append('text', text);
        res = await fetch(url, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20000)
        });
      }

      const data = await res.json() as any;
      if (data?.status === true || data?.ok === true || res.ok) {
        const msgId = data?.data?.message_id || data?.result?.message_id;
        return {
          success: true,
          platform: 'eitaa',
          channel: targetChannel,
          message_id: msgId
        };
      }
      return {
        success: false,
        platform: 'eitaa',
        channel: targetChannel,
        error: data?.message || data?.description || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        platform: 'eitaa',
        channel: targetChannel,
        error: `خطا در ارسال پیام به ایتا: ${err.message}`
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
    if (!this.isEnabled()) return { success: false, platform: 'eitaa', error: 'ارسال به ایتا غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'eitaa', error: 'توکن ایتا تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'eitaa', error: 'کانال مقصد ایتا مشخص نشده است.' };

    const baseUrl = this.getBaseUrl();
    const blob = fileData instanceof Blob ? fileData : new Blob([fileData]);
    const form = new FormData();
    form.append('chat_id', targetChannel);

    let url: string;
    if (this.apiType === 'direct') {
      const methodMap: Record<string, string> = {
        photo: 'sendPhoto',
        video: 'sendVideo',
        document: 'sendDocument',
        voice: 'sendVoice',
        audio: 'sendAudio'
      };
      const method = methodMap[mediaType] || 'sendDocument';
      url = `${baseUrl}${method}`;
      form.append('file', blob, fileName);
      if (caption) form.append('caption', caption);
    } else {
      url = `${baseUrl}sendFile`;
      form.append('file', blob, fileName);
      if (caption) form.append('caption', caption);
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000)
      });
      const data = await res.json() as any;

      if (data?.status === true || data?.ok === true || res.ok) {
        const msgId = data?.data?.message_id || data?.result?.message_id;
        return {
          success: true,
          platform: 'eitaa',
          channel: targetChannel,
          message_id: msgId
        };
      }
      return {
        success: false,
        platform: 'eitaa',
        channel: targetChannel,
        error: data?.message || data?.description || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        platform: 'eitaa',
        channel: targetChannel,
        error: `خطا در ارسال فایل به ایتا: ${err.message}`
      };
    }
  }
}

export const eitaaService = new EitaaService();
