import os
import shutil
import asyncio
from typing import Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, Request, Form, UploadFile, File, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import config, MEDIA_DIR, BASE_DIR
from forwarder.dispatcher import dispatcher
from bot.telegram_listener import bot_manager

app = FastAPI(title="Telegram Multi-Channel Cross-Poster")

WEB_DIR = BASE_DIR / "web"
TEMPLATES_DIR = WEB_DIR / "templates"
STATIC_DIR = WEB_DIR / "static"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={
            "settings": config.settings.model_dump(),
            "channels": [c.model_dump() for c in config.settings.channels],
            "admin_usernames": ", ".join([f"@{u}" for u in config.settings.allowed_admin_usernames])
        }
    )

@app.get("/api/status")
async def get_status():
    tg_info = await bot_manager.get_bot_info()
    return {
        "is_paused": config.settings.is_paused,
        "channels": [c.model_dump() for c in config.settings.channels],
        "telegram": {
            "running": bot_manager.is_running,
            "configured": bool(config.settings.telegram_bot_token),
            "info": tg_info
        },
        "bale": {
            "enabled": config.settings.enable_bale,
            "configured": bool(config.settings.bale_bot_token)
        },
        "rubika": {
            "enabled": config.settings.enable_rubika,
            "configured": bool(config.settings.rubika_bot_token)
        },
        "eitaa": {
            "enabled": config.settings.enable_eitaa,
            "configured": bool(config.settings.eitaa_token),
            "api_type": config.settings.eitaa_api_type
        }
    }

@app.post("/api/toggle-pause")
async def toggle_global_pause():
    new_state = config.toggle_global_pause()
    return {"success": True, "is_paused": new_state}

@app.post("/api/channels/{channel_id}/toggle")
async def toggle_channel(channel_id: str):
    res = config.toggle_channel_pause(channel_id)
    if res is None:
        return JSONResponse(status_code=404, content={"success": False, "error": "کانال یافت نشد"})
    return {"success": True, "channel_id": channel_id, "is_active": res}

@app.post("/api/settings")
async def save_settings(request: Request):
    try:
        data = await request.json()
        # Protect tokens: tokens cannot be edited from web
        config.update_settings(data, allow_token_edit=False)
        return {"success": True, "message": "تنظیمات ذخیره شد (توکن‌ها جهت امنیت قفل هستند)."}
    except Exception as e:
        return JSONResponse(status_code=400, content={"success": False, "error": str(e)})

@app.post("/api/test-connection/{platform}")
async def test_platform_connection(platform: str):
    if platform == "telegram":
        return await bot_manager.get_bot_info()
    elif platform == "bale":
        return await dispatcher.bale.test_connection()
    elif platform == "rubika":
        return await dispatcher.rubika.test_connection()
    elif platform == "eitaa":
        return await dispatcher.eitaa.test_connection()
    elif platform == "all":
        return await dispatcher.test_all_connections()
    return {"success": False, "error": "پلتفرم نامعتبر است"}

@app.post("/api/test-broadcast")
async def test_broadcast(
    channel_id: str = Form("health"),
    text: str = Form(""),
    file: Optional[UploadFile] = File(None)
):
    channel = next((c for c in config.settings.channels if c.id == channel_id), None)
    if not channel:
        return JSONResponse(status_code=400, content={"success": False, "error": "کانال انتخابی یافت نشد."})

    try:
        if file and file.filename:
            ext = os.path.splitext(file.filename)[1].lower()
            temp_path = MEDIA_DIR / f"test_{file.filename}"
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            media_type = "document"
            if ext in [".jpg", ".jpeg", ".png", ".webp"]:
                media_type = "photo"
            elif ext in [".mp4", ".mov", ".mkv"]:
                media_type = "video"
            elif ext in [".mp3", ".wav", ".m4a"]:
                media_type = "audio"
            elif ext in [".ogg"]:
                media_type = "voice"
            elif ext in [".gif"]:
                media_type = "animation"

            try:
                res = await dispatcher.broadcast_for_channel(
                    channel=channel,
                    media_type=media_type,
                    file_path=str(temp_path),
                    caption=text,
                    file_name=file.filename,
                    source="Web Test",
                    post_id="web_test"
                )
                return {"success": True, "results": res}
            finally:
                if temp_path.exists():
                    os.remove(temp_path)
        else:
            if not text.strip():
                return JSONResponse(status_code=400, content={"success": False, "error": "متن نمی‌تواند خالی باشد."})

            res = await dispatcher.broadcast_for_channel(
                channel=channel,
                media_type="text",
                raw_text=text,
                source="Web Test",
                post_id="web_test"
            )
            return {"success": True, "results": res}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/logs")
async def get_logs():
    return {
        "history": dispatcher.get_recent_history(50)
    }

@app.post("/api/restart-bot")
async def restart_telegram_bot(background_tasks: BackgroundTasks):
    async def _restart():
        await bot_manager.stop()
        await asyncio.sleep(1)
        asyncio.create_task(bot_manager.start())

    background_tasks.add_task(_restart)
    return {"success": True, "message": "ربات مجدداً راه‌اندازی شد."}
