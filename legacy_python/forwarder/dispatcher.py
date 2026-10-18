import os
import re
import asyncio
import logging
from datetime import datetime
from collections import deque
from typing import Dict, Any, Optional, List
from pathlib import Path

from config import config, ChannelProfile, MEDIA_DIR, LOGS_DIR
from forwarder.bale_sender import BaleSender
from forwarder.eitaa_sender import EitaaSender
from forwarder.rubika_sender import RubikaSender

logger = logging.getLogger("forwarder")
logger.setLevel(logging.INFO)

class PostHistoryItem:
    def __init__(
        self,
        post_id: str,
        source: str,
        channel_name: str,
        media_type: str,
        content_preview: str,
        results: Dict[str, Any]
    ):
        self.post_id = post_id
        self.source = source
        self.channel_name = channel_name
        self.media_type = media_type
        self.content_preview = content_preview
        self.timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.results = results

    def to_dict(self) -> Dict[str, Any]:
        return {
            "post_id": self.post_id,
            "source": self.source,
            "channel_name": self.channel_name,
            "media_type": self.media_type,
            "content_preview": self.content_preview,
            "timestamp": self.timestamp,
            "results": self.results
        }

class Dispatcher:
    _instance: Optional["Dispatcher"] = None

    def __init__(self):
        self.bale = BaleSender()
        self.eitaa = EitaaSender()
        self.rubika = RubikaSender()
        self.history: deque = deque(maxlen=100)

    @classmethod
    def get_instance(cls) -> "Dispatcher":
        if cls._instance is None:
            cls._instance = Dispatcher()
        return cls._instance

    def format_text_for_channel(self, text: Optional[str], channel: ChannelProfile, platform: str) -> str:
        """Transforms text specifically for the target channel and platform."""
        if not text:
            return ""

        # Replace TG handle with destination handle
        tg_clean = channel.telegram_id.lstrip("@")
        if platform == "bale" and channel.bale_id:
            bale_clean = channel.bale_id.lstrip("@")
            text = re.sub(rf"(?:https?://)?(?:t\.me/|@){re.escape(tg_clean)}\b", f"@{bale_clean}", text, flags=re.IGNORECASE)
        elif platform == "rubika" and channel.rubika_id:
            rub_clean = channel.rubika_id.lstrip("@")
            text = re.sub(rf"(?:https?://)?(?:t\.me/|@){re.escape(tg_clean)}\b", f"@{rub_clean}", text, flags=re.IGNORECASE)
        elif platform == "eitaa" and channel.eitaa_id:
            eitaa_clean = channel.eitaa_id.lstrip("@")
            text = re.sub(rf"(?:https?://)?(?:t\.me/|@){re.escape(tg_clean)}\b", f"@{eitaa_clean}", text, flags=re.IGNORECASE)

        # Strip telegram links if requested
        if config.settings.remove_telegram_links:
            text = re.sub(r"https?://t\.me/[a-zA-Z0-9_+/]+", "", text)

        # Append channel footer if defined
        footer = ""
        if platform == "bale" and channel.bale_footer:
            footer = channel.bale_footer
        elif platform == "rubika" and channel.rubika_footer:
            footer = channel.rubika_footer
        elif platform == "eitaa" and channel.eitaa_footer:
            footer = channel.eitaa_footer

        if footer:
            text = f"{text.strip()}\n\n{footer.strip()}".strip()

        return text.strip()

    async def test_all_connections(self) -> Dict[str, Any]:
        tasks = [
            self.bale.test_connection(),
            self.rubika.test_connection(),
            self.eitaa.test_connection()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            "bale": results[0] if not isinstance(results[0], Exception) else {"success": False, "error": str(results[0])},
            "rubika": results[1] if not isinstance(results[1], Exception) else {"success": False, "error": str(results[1])},
            "eitaa": results[2] if not isinstance(results[2], Exception) else {"success": False, "error": str(results[2])},
        }

    async def broadcast_for_channel(
        self,
        channel: ChannelProfile,
        media_type: str = "text",
        raw_text: Optional[str] = None,
        file_path: Optional[str] = None,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        source: str = "Telegram",
        post_id: str = "post"
    ) -> Dict[str, Any]:
        """Broadcasts a post specifically to the destinations of this channel."""
        # Check global pause
        if config.settings.is_paused:
            logger.info(f"Broadcast skipped: System is globally paused by admin.")
            return {"status": "paused", "message": "ربات موقتاً متوقف شده است."}

        # Check channel active state
        if not channel.is_active:
            logger.info(f"Broadcast skipped: Channel '{channel.title}' is disabled.")
            return {"status": "channel_disabled", "message": f"کانال {channel.title} غیرفعال است."}

        logger.info(f"Dispatching [{media_type}] for channel '{channel.title}' ({channel.telegram_id})")

        results = {}
        tasks = []
        platforms = []

        # 1. Bale
        if self.bale.is_enabled() and channel.bale_id:
            if media_type == "text":
                bale_text = self.format_text_for_channel(raw_text, channel, "bale")
                tasks.append(self.bale.send_text(bale_text, target_channel=channel.bale_id))
            else:
                bale_cap = self.format_text_for_channel(caption, channel, "bale") if caption else None
                tasks.append(self.bale.send_media(media_type, file_path, bale_cap, file_name, target_channel=channel.bale_id))
            platforms.append("bale")
        else:
            results["bale"] = {"success": False, "skipped": True, "error": "غیرفعال یا آیدی کانال تنظیم نشده"}

        # 2. Rubika
        if self.rubika.is_enabled() and channel.rubika_id:
            if media_type == "text":
                rub_text = self.format_text_for_channel(raw_text, channel, "rubika")
                tasks.append(self.rubika.send_text(rub_text, target_channel=channel.rubika_id))
            else:
                rub_cap = self.format_text_for_channel(caption, channel, "rubika") if caption else None
                tasks.append(self.rubika.send_media(media_type, file_path, rub_cap, file_name, target_channel=channel.rubika_id))
            platforms.append("rubika")
        else:
            results["rubika"] = {"success": False, "skipped": True, "error": "غیرفعال یا آیدی کانال تنظیم نشده"}

        # 3. Eitaa
        if self.eitaa.is_enabled() and channel.eitaa_id and self.eitaa.is_configured():
            if media_type == "text":
                eitaa_text = self.format_text_for_channel(raw_text, channel, "eitaa")
                tasks.append(self.eitaa.send_text(eitaa_text, target_channel=channel.eitaa_id))
            else:
                eitaa_cap = self.format_text_for_channel(caption, channel, "eitaa") if caption else None
                tasks.append(self.eitaa.send_media(media_type, file_path, eitaa_cap, file_name, target_channel=channel.eitaa_id))
            platforms.append("eitaa")
        else:
            results["eitaa"] = {"success": False, "skipped": True, "error": "غیرفعال یا تنظیم نشده"}

        # Run concurrently
        if tasks:
            task_results = await asyncio.gather(*tasks, return_exceptions=True)
            for plat, res in zip(platforms, task_results):
                if isinstance(res, Exception):
                    results[plat] = {"success": False, "error": str(res)}
                else:
                    results[plat] = res

        # Record in history
        preview = raw_text if media_type == "text" else (caption or f"[{media_type.upper()}]")
        item = PostHistoryItem(
            post_id=post_id,
            source=source,
            channel_name=channel.title,
            media_type=media_type,
            content_preview=(preview[:100] if preview else ""),
            results=results
        )
        self.history.appendleft(item)
        logger.info(f"Broadcast for '{channel.title}' completed: {results}")
        return results

    def get_recent_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        return [item.to_dict() for item in list(self.history)[:limit]]

dispatcher = Dispatcher.get_instance()
