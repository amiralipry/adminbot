import os
import asyncio
from typing import Dict, Any, Optional
from forwarder.base import BaseSender
from config import config

class RubikaSender(BaseSender):
    platform_name: str = "rubika"

    def __init__(self):
        self._client = None
        self._cached_token = None

    @property
    def token(self) -> str:
        return config.settings.rubika_bot_token.strip()

    def is_enabled(self) -> bool:
        return config.settings.enable_rubika

    def is_configured(self) -> bool:
        return bool(self.token)

    async def _get_client(self):
        import rubpy
        if self._client is None or self._cached_token != self.token:
            if self._client:
                try:
                    await self._client.close()
                except Exception:
                    pass
            self._client = rubpy.BotClient(token=self.token)
            self._cached_token = self.token
        return self._client

    async def test_connection(self) -> Dict[str, Any]:
        """Test Rubika Bot token validity via getMe."""
        if not self.token:
            return {"success": False, "platform": self.platform_name, "error": "توکن ربات روبیکا وارد نشده است."}

        try:
            client = await self._get_client()
            bot_info = await client.get_me()
            name = getattr(bot_info, "bot_title", "") or getattr(bot_info, "username", "Rubika Bot")
            username = getattr(bot_info, "username", "")
            return {
                "success": True,
                "platform": self.platform_name,
                "bot_name": name,
                "bot_username": username,
                "message": f"اتصال به روبیکا برقرار است (ربات: {name})"
            }
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در اتصال به روبیکا: {str(e)}"}

    async def send_text(self, text: str, target_channel: Optional[str] = None) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "platform": self.platform_name, "error": "ارسال به روبیکا غیرفعال است."}
        if not self.is_configured():
            return {"success": False, "platform": self.platform_name, "error": "توکن روبیکا تنظیم نشده است."}

        chat_id = target_channel
        if not chat_id:
            return {"success": False, "platform": self.platform_name, "error": "کانال مقصد روبیکا مشخص نشده است."}

        try:
            client = await self._get_client()
            res = await client.send_message(
                chat_id=chat_id,
                text=text
            )
            msg_id = getattr(res, "message_id", None)
            return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارسال پیام به روبیکا: {str(e)}", "channel": chat_id}

    async def send_media(
        self,
        media_type: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        target_channel: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"success": False, "platform": self.platform_name, "error": "ارسال به روبیکا غیرفعال است."}
        if not self.is_configured():
            return {"success": False, "platform": self.platform_name, "error": "توکن روبیکا تنظیم نشده است."}

        chat_id = target_channel
        if not chat_id:
            return {"success": False, "platform": self.platform_name, "error": "کانال مقصد روبیکا مشخص نشده است."}

        if not os.path.exists(file_path):
            return {"success": False, "platform": self.platform_name, "error": "فایل مدیا یافت نشد."}

        type_map = {
            "photo": "Image",
            "video": "Video",
            "voice": "Voice",
            "audio": "Music",
            "animation": "Gif",
            "document": "File"
        }
        rub_type = type_map.get(media_type, "File")

        try:
            client = await self._get_client()
            res = await client.send_file(
                chat_id=chat_id,
                file=file_path,
                text=caption or "",
                file_name=file_name or os.path.basename(file_path),
                type=rub_type
            )
            msg_id = getattr(res, "message_id", None)
            return {"success": True, "platform": self.platform_name, "message_id": msg_id, "channel": chat_id}
        except Exception as e:
            return {"success": False, "platform": self.platform_name, "error": f"خطا در ارسال فایل به روبیکا: {str(e)}", "channel": chat_id}
