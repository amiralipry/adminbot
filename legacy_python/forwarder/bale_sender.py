import os
import aiohttp
import asyncio
from typing import Dict, Any, Optional
from forwarder.base import BaseSender
from config import config

class BaleSender(BaseSender):
    platform_name: str = "bale"

    def __init__(self):
        self.base_url = "https://tapi.bale.ai/bot"

    @property
    def token(self) -> str:
        return config.settings.bale_bot_token.strip()

    def is_enabled(self) -> bool:
        return config.settings.enable_bale

    def is_configured(self) -> bool:
        return bool(self.token)

    def _get_api_url(self, method: str) -> str:
        return f"{self.base_url}{self.token}/{method}"

    async def test_connection(self) -> Dict[str, Any]:
        """Verify Bale token by calling getMe."""
        if not self.token:
            return {"success": False, "platform": self.platform_name, "error": "توکن بازوی بله وارد نشده است."}

        url = self._get_api_url("getMe")
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.get(url) as resp:
                    data = await resp.json()
                    if resp.status == 200 and data.get("ok"):
                        result = data.get("result", {})
                        username = result.get("username", "Unknown")
                        first_name = result.get("first_name", "Bot")
                        return {
                            "success": True,
                            "platform": self.platform_name,
                            "bot_username": username,
                            "bot_name": first_name,
                            "message": f"اتصال به بله موفق بود (بازو: @{username})"
                        }
                    else:
                        return {
                            "success": False,
                            "platform": self.platform_name,
                            "error": data.get("description", f"کد وضعیت ناموفق: {resp.status}")
                        }
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارتباط با سرور بله: {str(e)}"}

    async def send_text(self, text: str, target_channel: Optional[str] = None) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "platform": self.platform_name, "error": "ارسال به بله غیرفعال است."}
        if not self.is_configured():
            return {"success": False, "platform": self.platform_name, "error": "توکن بله تنظیم نشده است."}

        chat_id = target_channel
        if not chat_id:
            return {"success": False, "platform": self.platform_name, "error": "کانال مقصد بله مشخص نشده است."}

        url = self._get_api_url("sendMessage")
        payload = {
            "chat_id": chat_id,
            "text": text
        }

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
                async with session.post(url, json=payload) as resp:
                    data = await resp.json()
                    if resp.status == 200 and data.get("ok"):
                        msg_id = data.get("result", {}).get("message_id")
                        return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
                    else:
                        err = data.get("description", f"HTTP {resp.status}")
                        return {"success": False, "platform": self.platform_name, "error": f"پاسخ بله: {err}", "channel": chat_id}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارسال پیام به بله: {str(e)}", "channel": chat_id}

    async def send_media(
        self,
        media_type: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        target_channel: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "platform": self.platform_name, "error": "ارسال به بله غیرفعال است."}
        if not self.is_configured():
            return {"success": False, "platform": self.platform_name, "error": "توکن بله تنظیم نشده است."}

        chat_id = target_channel
        if not chat_id:
            return {"success": False, "platform": self.platform_name, "error": "کانال مقصد بله مشخص نشده است."}

        if not os.path.exists(file_path):
            return {"success": False, "platform": self.platform_name, "error": "فایل مدیا یافت نشد."}

        method_map = {
            "photo": ("sendPhoto", "photo"),
            "video": ("sendVideo", "video"),
            "document": ("sendDocument", "document"),
            "voice": ("sendVoice", "voice"),
            "audio": ("sendAudio", "audio"),
            "animation": ("sendAnimation", "animation")
        }
        method, field_name = method_map.get(media_type, ("sendDocument", "document"))
        url = self._get_api_url(method)
        fname = file_name or os.path.basename(file_path)

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
                with open(file_path, "rb") as f:
                    form = aiohttp.FormData()
                    form.add_field("chat_id", chat_id)
                    form.add_field(field_name, f, filename=fname)
                    if caption:
                        form.add_field("caption", caption)

                    async with session.post(url, data=form) as resp:
                        data = await resp.json()
                        if resp.status == 200 and data.get("ok"):
                            msg_id = data.get("result", {}).get("message_id")
                            return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
                        else:
                            err = data.get("description", f"HTTP {resp.status}")
                            return {"success": False, "platform": self.platform_name, "error": f"پاسخ بله: {err}", "channel": chat_id}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارسال مدیا به بله: {str(e)}", "channel": chat_id}
