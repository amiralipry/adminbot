import { config } from '../config';
import type { PlatformResult } from '../types';

export class EitaaService {
  private get token(): string {
    return config.settings.eitaa_token.trim();
  }

  private get apiType(): string {
    return (config.settings.eitaa_api_type || 'eitaayar').trim().toLowerCase();
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
      const data = await res.json() as any;

      if (data?.ok === true || data?.status === true) {
        const name = data.result?.first_name || data.result?.username || 'Eitaayar Bot';
        const user = data.result?.username ? ` (@${data.result.username})` : '';
        return {
          success: true,
          platform: 'eitaa',
          message_id: `متصل: ${name}${user}`
        };
      }
      return {
        success: false,
        platform: 'eitaa',
        error: data?.description || data?.message || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return { success: false, platform: 'eitaa', error: `خطا در ارتباط با ایتا: ${err.message}` };
    }
  }

  public async sendText(text: string, targetChannel: string): Promise<PlatformResult> {
    if (!this.isEnabled()) return { success: false, platform: 'eitaa', error: 'ارسال به ایتا غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'eitaa', error: 'توکن ایتا تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'eitaa', error: 'کانال مقصد ایتا مشخص نشده است.' };

    const cleanChatId = targetChannel.replace(/^@/, '').trim();
    const url = `${this.getBaseUrl()}sendMessage`;

    try {
      const form = new FormData();
      form.append('chat_id', cleanChatId);
      form.append('text', text);

      const res = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(25000)
      });

      const data = await res.json() as any;
      if (data?.ok === true || data?.status === true) {
        const msgId = data?.result?.message_id || data?.data?.message_id;
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
        error: data?.description || data?.message || `خطای ایتا (کد ${data?.error_code || res.status})`
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

    const cleanChatId = targetChannel.replace(/^@/, '').trim();
    const baseUrl = this.getBaseUrl();
    const blob = fileData instanceof Blob ? fileData : new Blob([fileData]);
    const form = new FormData();
    form.append('chat_id', cleanChatId);
    form.append('file', blob, fileName);
    if (caption) form.append('caption', caption);

    const url = `${baseUrl}sendFile`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(90000)
      });
      const data = await res.json() as any;

      if (data?.ok === true || data?.status === true) {
        const msgId = data?.result?.message_id || data?.data?.message_id;
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
        error: data?.description || data?.message || `خطای ایتا (کد ${data?.error_code || res.status})`
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
