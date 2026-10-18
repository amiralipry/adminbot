import os
import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MEDIA_DIR = DATA_DIR / "media"
LOGS_DIR = DATA_DIR / "logs"
CONFIG_FILE = BASE_DIR / "config.json"
ENV_FILE = BASE_DIR / ".env"

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

class ChannelProfile(BaseModel):
    id: str
    title: str
    telegram_id: str
    bale_id: str
    rubika_id: str
    eitaa_id: str = ""
    is_active: bool = True
    bale_footer: str = ""
    rubika_footer: str = ""
    eitaa_footer: str = ""

DEFAULT_CHANNELS = [
    ChannelProfile(
        id="health",
        title="سیکاپ هلث",
        telegram_id="@sikaaphealth",
        bale_id="@sikaaphealth",
        rubika_id="@sikaaphealth",
        eitaa_id="@sikaaphealth",
        is_active=True
    ),
    ChannelProfile(
        id="food",
        title="سیکاپ فود",
        telegram_id="@sikaapfood",
        bale_id="@sikaapfood",
        rubika_id="@sikaapfood",
        eitaa_id="@sikaapfood",
        is_active=True
    ),
    ChannelProfile(
        id="farayad",
        title="فرایاد",
        telegram_id="@Farayad_App",
        bale_id="@Farayad_App",
        rubika_id="@Farayad_App",
        eitaa_id="@Farayad_App",
        is_active=True
    )
]

class AppSettings(BaseModel):
    # Telegram Bot Token (Protected / Read-only in Web)
    telegram_bot_token: str = Field(default="")
    allowed_admin_usernames: List[str] = Field(default_factory=list)
    
    # Global state
    is_paused: bool = Field(default=False, description="Whether forwarding is temporarily paused")

    # The 3 specialized channels
    channels: List[ChannelProfile] = Field(default_factory=lambda: DEFAULT_CHANNELS)

    # Bale settings (Protected token)
    enable_bale: bool = Field(default=True)
    bale_bot_token: str = Field(default="")

    # Rubika settings (Protected token)
    enable_rubika: bool = Field(default=True)
    rubika_bot_token: str = Field(default="")

    # Eitaa settings
    enable_eitaa: bool = Field(default=True)
    eitaa_api_type: str = Field(default="eitaayar")
    eitaa_token: str = Field(default="")

    # General
    remove_telegram_links: bool = Field(default=False)
    enable_web_dashboard: bool = Field(default=True)
    web_host: str = Field(default="127.0.0.1")
    web_port: int = Field(default=5000)

class ConfigManager:
    _instance: Optional["ConfigManager"] = None
    settings: AppSettings

    def __init__(self):
        self.settings = AppSettings()
        self.load()

    @classmethod
    def get_instance(cls) -> "ConfigManager":
        if cls._instance is None:
            cls._instance = ConfigManager()
        return cls._instance

    def load(self):
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # If older format without channels list, merge defaults
                    if "channels" not in data or not data["channels"]:
                        data["channels"] = [c.model_dump() for c in DEFAULT_CHANNELS]
                    if "allowed_admin_usernames" not in data:
                        data["allowed_admin_usernames"] = []
                    self.settings = AppSettings(**data)
                    return
            except Exception as e:
                print(f"[Config] Error loading config.json: {e}")

        self.save()

    def save(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.settings.model_dump(), f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[Config] Error saving config: {e}")

    def update_settings(self, new_data: Dict[str, Any], allow_token_edit: bool = False):
        current = self.settings.model_dump()

        # If token edit is forbidden, lock tokens from being overwritten
        if not allow_token_edit:
            protected_keys = ["telegram_bot_token", "bale_bot_token", "rubika_bot_token"]
            for pk in protected_keys:
                if pk in new_data:
                    del new_data[pk]

        current.update(new_data)
        self.settings = AppSettings(**current)
        self.save()

    def get_channel_by_telegram_id(self, tg_id_or_username: str) -> Optional[ChannelProfile]:
        clean = tg_id_or_username.lower().lstrip("@")
        for ch in self.settings.channels:
            if ch.telegram_id.lower().lstrip("@") == clean:
                return ch
        return None

    def toggle_global_pause(self) -> bool:
        self.settings.is_paused = not self.settings.is_paused
        self.save()
        return self.settings.is_paused

    def toggle_channel_pause(self, channel_id: str) -> Optional[bool]:
        for ch in self.settings.channels:
            if ch.id == channel_id:
                ch.is_active = not ch.is_active
                self.save()
                return ch.is_active
        return None

config = ConfigManager.get_instance()
