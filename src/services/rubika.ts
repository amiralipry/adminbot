import { config } from '../config';
import type { PlatformResult } from '../types';

export class RubikaService {
  private baseUrl = 'https://botapi.rubika.ir/v3/';

  private get token(): string {
    return config.settings.rubika_bot_token.trim();
  }

  public isEnabled(): boolean {
    return config.settings.enable_rubika;
  }

  public isConfigured(): boolean {
    return Boolean(this.token);
  }

  private getApiUrl(method: string): string {
    return `${this.baseUrl}${this.token}/${method}`;
  }

  public async testConnection(): Promise<PlatformResult> {
    if (!this.token) {
      return { success: false, platform: 'rubika', error: 'توکن ربات روبیکا وارد نشده است.' };
    }

    try {
      const url = this.getApiUrl('getMe');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(25000)
      });
      const data = await res.json() as any;

      if (res.ok && data?.status === 'OK') {
        const botName = data.data?.bot?.bot_title || 'Rubika Bot';
        return {
          success: true,
          platform: 'rubika',
          message_id: botName
        };
      }
      return {
        success: false,
        platform: 'rubika',
        error: data?.dev_message || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return { success: false, platform: 'rubika', error: `خطا در ارتباط با روبیکا: ${err.message}` };
    }
  }

  public async sendText(text: string, targetChannel: string): Promise<PlatformResult> {
    if (!this.isEnabled()) return { success: false, platform: 'rubika', error: 'ارسال به روبیکا غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'rubika', error: 'توکن روبیکا تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'rubika', error: 'کانال مقصد روبیکا مشخص نشده است.' };

    try {
      const url = this.getApiUrl('sendMessage');
      let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChannel,
          text
        }),
        signal: AbortSignal.timeout(30000)
      });
      let data = await res.json() as any;

      // Fallback: If chat_id is not valid, try alternate format (with/without @)
      if (data?.dev_message?.includes('chat_id is not valid') || data?.status === 'ERROR_GENERIC') {
        const altChatId = targetChannel.startsWith('@') ? targetChannel.replace(/^@/, '') : `@${targetChannel}`;
        try {
          const altRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: altChatId, text }),
            signal: AbortSignal.timeout(20000)
          });
          const altData = await altRes.json() as any;
          if (altRes.ok && altData?.status === 'OK') {
            res = altRes;
            data = altData;
          }
        } catch {}
      }

      if (res.ok && data?.status === 'OK') {
        return {
          success: true,
          platform: 'rubika',
          channel: targetChannel,
          message_id: data.data?.message_id
        };
      }
      return {
        success: false,
        platform: 'rubika',
        channel: targetChannel,
        error: `پاسخ روبیکا: ${data?.dev_message || data?.status || res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        platform: 'rubika',
        channel: targetChannel,
        error: `خطا در ارسال پیام به روبیکا: ${err.message}`
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
    if (!this.isEnabled()) return { success: false, platform: 'rubika', error: 'ارسال به روبیکا غیرفعال است.' };
    if (!this.isConfigured()) return { success: false, platform: 'rubika', error: 'توکن روبیکا تنظیم نشده است.' };
    if (!targetChannel) return { success: false, platform: 'rubika', error: 'کانال مقصد روبیکا مشخص نشده است.' };

    const typeMap: Record<string, string> = {
      photo: 'Image',
      video: 'Video',
      voice: 'Voice',
      audio: 'Music',
      animation: 'Gif',
      document: 'File'
    };
    const rubType = typeMap[mediaType] || 'File';

    try {
      // 1. Request upload URL
      const reqUrl = this.getApiUrl('requestSendFile');
      const reqRes = await fetch(reqUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: rubType }),
        signal: AbortSignal.timeout(15000)
      });
      const reqData = await reqRes.json() as any;

      if (!reqRes.ok || reqData?.status !== 'OK' || !reqData.data?.upload_url) {
        return {
          success: false,
          platform: 'rubika',
          channel: targetChannel,
          error: `درخواست آپلود فایل در روبیکا ناموفق بود: ${reqData?.dev_message || reqRes.status}`
        };
      }

      const uploadUrl = reqData.data.upload_url;

      // 2. Upload file to uploadUrl
      const form = new FormData();
      const blob = fileData instanceof Blob ? fileData : new Blob([fileData]);
      form.append('file', blob, fileName);

      const upRes = await fetch(uploadUrl, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000)
      });
      const upData = await upRes.json() as any;

      if (!upRes.ok || upData?.status !== 'OK' || !upData.data?.file_id) {
        return {
          success: false,
          platform: 'rubika',
          channel: targetChannel,
          error: `آپلود فایل در سرور مدیا روبیکا ناموفق بود: ${upData?.dev_message || upRes.status}`
        };
      }

      const fileId = upData.data.file_id;

      // 3. Send file message
      const sendUrl = this.getApiUrl('sendFile');
      let sendRes = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChannel,
          file_id: fileId,
          text: caption || '',
          type: rubType
        }),
        signal: AbortSignal.timeout(20000)
      });
      let sendData = await sendRes.json() as any;

      // Fallback: If chat_id is not valid, try alternate format (with/without @)
      if (sendData?.dev_message?.includes('chat_id is not valid') || sendData?.status === 'ERROR_GENERIC') {
        const altChatId = targetChannel.startsWith('@') ? targetChannel.replace(/^@/, '') : `@${targetChannel}`;
        try {
          const altRes = await fetch(sendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: altChatId,
              file_id: fileId,
              text: caption || '',
              type: rubType
            }),
            signal: AbortSignal.timeout(20000)
          });
          const altData = await altRes.json() as any;
          if (altRes.ok && altData?.status === 'OK') {
            sendRes = altRes;
            sendData = altData;
          }
        } catch {}
      }

      if (sendRes.ok && sendData?.status === 'OK') {
        return {
          success: true,
          platform: 'rubika',
          channel: targetChannel,
          message_id: sendData.data?.message_id
        };
      }
      return {
        success: false,
        platform: 'rubika',
        channel: targetChannel,
        error: `پاسخ روبیکا در ارسال فایل: ${sendData?.dev_message || sendData?.status || sendRes.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        platform: 'rubika',
        channel: targetChannel,
        error: `خطا در آپلود و ارسال فایل به روبیکا: ${err.message}`
      };
    }
  }
}

export const rubikaService = new RubikaService();
