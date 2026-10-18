import os
import aiohttp
import asyncio
from typing import Dict, Any, Optional
from forwarder.base import BaseSender
from config import config

class EitaaSender(BaseSender):
    platform_name: str = "eitaa"

    def __init__(self):
        pass

    @property
    def token(self) -> str:
        return config.settings.eitaa_token.strip()

    @property
    def api_type(self) -> str:
        return config.settings.eitaa_api_type.strip().lower()

    def is_enabled(self) -> bool:
        return config.settings.enable_eitaa

    def is_configured(self) -> bool:
        return bool(self.token)

    def _get_base_url(self) -> str:
        if self.api_type == "direct":
            return f"https://eitaa.com/api/{self.token}/"
        return f"https://eitaayar.ir/api/{self.token}/"

    async def test_connection(self) -> Dict[str, Any]:
        """Test Eitaa API token validity."""
        if not self.token:
            return {"success": False, "platform": self.platform_name, "error": "توکن ایتا وارد نشده است."}

        url = f"{self._get_base_url()}getMe"
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.get(url) as resp:
                    try:
                        data = await resp.json(content_type=None)
                    except Exception:
                        text = await resp.text()
                        return {
                            "success": resp.status in (200, 201),
                            "platform": self.platform_name,
                            "message": f"پاسخ سرور ایتا دریافت شد: {text[:100]}"
                        }

                    if (data.get("status") is True) or (data.get("ok") is True) or resp.status == 200:
                        return {
                            "success": True,
                            "platform": self.platform_name,
                            "message": "اتصال به وب‌سرویس ایتا برقرار است.",
                            "data": data
                        }
                    else:
                        err = data.get("message") or data.get("description") or f"کد وضعیت {resp.status}"
                        return {"success": False, "platform": self.platform_name, "error": f"خطای ایتا: {err}"}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارتباط با سرور ایتا: {str(e)}"}

    async def send_text(self, text: str, target_channel: Optional[str] = None) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "platform": self.platform_name, "error": "ارسال به ایتا غیرفعال است."}
        if not self.is_configured():
            return {"success": False, "platform": self.platform_name, "error": "توکن ایتا تنظیم نشده است."}

        chat_id = target_channel
        if not chat_id:
            return {"success": False, "platform": self.platform_name, "error": "کانال مقصد ایتا مشخص نشده است."}

        base_url = self._get_base_url()
        url = f"{base_url}sendMessage"
        payload = {"chat_id": chat_id, "text": text}

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
                if self.api_type == "direct":
                    async with session.post(url, json=payload) as resp:
                        data = await resp.json(content_type=None)
                        if data.get("ok") or resp.status == 200:
                            msg_id = data.get("result", {}).get("message_id")
                            return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
                        else:
                            return {"success": False, "platform": self.platform_name, "error": str(data), "channel": chat_id}
                else:
                    form = aiohttp.FormData()
                    form.add_field("chat_id", chat_id)
                    form.add_field("text", text)

                    async with session.post(url, data=form) as resp:
                        data = await resp.json(content_type=None)
                        if data.get("status") is True or resp.status == 200:
                            msg_id = data.get("data", {}).get("message_id")
                            return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
                        else:
                            err = data.get("message") or data.get("description") or str(data)
                            return {"success": False, "platform": self.platform_name, "error": f"پاسخ ایتا: {err}", "channel": chat_id}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارسال پیام به ایتا: {str(e)}", "channel": chat_id}

    async def send_media(
        self,
        media_type: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        target_channel: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "platform": self.platform_name, "error": "ارسال به ایتا غیرفعال است."}
        if not self.is_configured():
            return {"success": False, "platform": self.platform_name, "error": "توکن ایتا تنظیم نشده است."}

        chat_id = target_channel
        if not chat_id:
            return {"success": False, "platform": self.platform_name, "error": "کانال مقصد ایتا مشخص نشده است."}

        if not os.path.exists(file_path):
            return {"success": False, "platform": self.platform_name, "error": "فایل مدیا یافت نشد."}

        fname = file_name or os.path.basename(file_path)
        base_url = self._get_base_url()

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
                with open(file_path, "rb") as f:
                    form = aiohttp.FormData()
                    form.add_field("chat_id", chat_id)

                    if self.api_type == "direct":
                        method_map = {
                            "photo": ("sendPhoto", "photo"),
                            "video": ("sendVideo", "video"),
                            "document": ("sendDocument", "document"),
                            "voice": ("sendVoice", "voice"),
                            "audio": ("sendAudio", "audio"),
                        }
                        method, field_name = method_map.get(media_type, ("sendDocument", "document"))
                        url = f"{base_url}{method}"
                        form.add_field(field_name, f, filename=fname)
                        if caption:
                            form.add_field("caption", caption)
                    else:
                        url = f"{base_url}sendFile"
                        form.add_field("file", f, filename=fname)
                        if caption:
                            form.add_field("caption", caption)

                    async with session.post(url, data=form) as resp:
                        data = await resp.json(content_type=None)
                        if data.get("status") is True or data.get("ok") is True or resp.status == 200:
                            msg_id = data.get("data", {}).get("message_id") or data.get("result", {}).get("message_id")
                            return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
                        else:
                            err = data.get("message") or data.get("description") or str(data)
                            return {"success": False, "platform": self.platform_name, "error": f"پاسخ ایتا: {err}", "channel": chat_id}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارسال مدیا به ایتا: {str(e)}", "channel": chat_id}
