from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

class BaseSender(ABC):
    platform_name: str = "base"

    @abstractmethod
    def is_enabled(self) -> bool:
        """Check if this platform forwarding is enabled by user."""
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Check if required tokens and channel credentials are set."""
        pass

    @abstractmethod
    async def test_connection(self) -> Dict[str, Any]:
        """Test API credentials and connectivity."""
        pass

    @abstractmethod
    async def send_text(self, text: str, target_channel: Optional[str] = None) -> Dict[str, Any]:
        """Send a plain text message to the configured channel."""
        pass

    @abstractmethod
    async def send_media(
        self,
        media_type: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        target_channel: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send a media file (photo, video, document, voice, audio) to the channel.
        media_type: 'photo', 'video', 'document', 'voice', 'audio', 'animation'
        """
        pass
