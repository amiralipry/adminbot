import sys
import asyncio
import logging
import uvicorn
from pathlib import Path

# Ensure directory is in sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Ensure UTF-8 output on Windows consoles
if sys.platform.startswith("win"):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from config import config
from web.app import app
from bot.telegram_listener import bot_manager

# Set up main logger
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("main")

async def run_services():
    tasks = []
    server = None

    print("\n" + "="*70)
    print("🚀 ربات بازنشر محتوای چندپلتفرمه (تلگرام ➔ بله، ایتا، روبیکا)")
    print("="*70)

    # 1. Start Web Management Dashboard
    if config.settings.enable_web_dashboard:
        host = config.settings.web_host
        port = config.settings.web_port
        server_config = uvicorn.Config(
            app=app,
            host=host,
            port=port,
            log_level="warning"
        )
        server = uvicorn.Server(server_config)
        web_task = asyncio.create_task(server.serve())
        tasks.append(web_task)
        print(f"🌐 پنل مدیریت تحت وب در دسترس است:")
        print(f"👉 http://{host}:{port}")
        print("="*70)

    # 2. Start Telegram Listener
    if config.settings.telegram_bot_token:
        logger.info("در حال اتصال و راه‌اندازی لیسنر تلگرام...")
        tg_task = asyncio.create_task(bot_manager.start())
        tasks.append(tg_task)
    else:
        logger.warning("توکن ربات تلگرام هنوز تنظیم نشده است.")
        print(f"💡 لطفاً مرورگر خود را باز کرده و به آدرس http://{config.settings.web_host}:{config.settings.web_port} بروید تا توکن‌ها را ثبت کنید.")
        print("="*70)

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        logger.info("سرویس‌ها در حال توقف...")
    finally:
        if bot_manager.is_running:
            await bot_manager.stop()
        if server:
            server.should_exit = True

def main():
    try:
        asyncio.run(run_services())
    except KeyboardInterrupt:
        print("\n👋 برنامه با موفقیت متوقف شد.")

if __name__ == "__main__":
    main()
