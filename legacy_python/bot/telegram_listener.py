import os
import uuid
import asyncio
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path

from aiogram import Bot, Dispatcher as AiogramDispatcher, Router, F, types
from aiogram.filters import Command
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
)
from aiogram.enums import ChatType

from config import config, ChannelProfile, MEDIA_DIR
from forwarder.dispatcher import dispatcher

logger = logging.getLogger("telegram_bot")
logger.setLevel(logging.INFO)

router = Router()

# Buffer for Telegram Albums
album_buffer: Dict[str, Dict[str, Any]] = {}
album_lock = asyncio.Lock()

def is_authorized_admin(user: Optional[types.User]) -> bool:
    """Check if the user has an allowed admin username."""
    if not user or not user.username:
        return False
    username_clean = user.username.lower().lstrip("@")
    allowed = [u.lower().lstrip("@") for u in config.settings.allowed_admin_usernames]
    return username_clean in allowed

def get_main_menu_keyboard() -> InlineKeyboardMarkup:
    """Creates the main management inline keyboard."""
    pause_text = "▶️ فعال‌سازی و ادامه (Resume)" if config.settings.is_paused else "⏸️ توقف کامل سیستم (Pause)"
    pause_cb = "cb:toggle_global"

    buttons = [
        [
            InlineKeyboardButton(text=pause_text, callback_data=pause_cb),
            InlineKeyboardButton(text="📊 تست اتصال پیام‌رسان‌ها", callback_data="cb:test_conns")
        ],
        [
            InlineKeyboardButton(text="🏥 سیکاپ هلث", callback_data="cb:ch:health"),
            InlineKeyboardButton(text="🍔 سیکاپ فود", callback_data="cb:ch:food"),
            InlineKeyboardButton(text="📚 فرایاد", callback_data="cb:ch:farayad")
        ],
        [
            InlineKeyboardButton(text="📜 مشاهده آخرین لاگ‌ها", callback_data="cb:logs"),
            InlineKeyboardButton(text="🔄 تازه‌سازی وضعیت", callback_data="cb:main_menu")
        ]
    ]
    return InlineKeyboardMarkup(inline_keyboard=buttons)

def get_channel_keyboard(ch: ChannelProfile) -> InlineKeyboardMarkup:
    """Creates inline keyboard for a specific channel profile."""
    status_toggle_text = "🔴 غیرفعال‌سازی این کانال" if ch.is_active else "🟢 فعال‌سازی این کانال"
    buttons = [
        [
            InlineKeyboardButton(text=status_toggle_text, callback_data=f"cb:toggle_ch:{ch.id}"),
            InlineKeyboardButton(text="🚀 ارسال پست تست", callback_data=f"cb:test_post:{ch.id}")
        ],
        [
            InlineKeyboardButton(text="🔙 بازگشت به منوی اصلی", callback_data="cb:main_menu")
        ]
    ]
    return InlineKeyboardMarkup(inline_keyboard=buttons)

def render_main_menu_text(user_first_name: str) -> str:
    global_status = "🔴 متوقف شده (Pause)" if config.settings.is_paused else "🟢 در حال کار و بازنشر فعال"

    channels_text = ""
    for ch in config.settings.channels:
        icon = "🟢" if ch.is_active else "🔴"
        channels_text += f"▫️ {icon} **{ch.title}** ({ch.telegram_id})\n"

    text = (
        f"سلام {user_first_name} عزیز 🌺\n"
        f"به پنل کنترل ربات بازنشر خودکار محتوا خوش آمدید.\n\n"
        f"⚙️ **وضعیت کلی سیستم:** {global_status}\n\n"
        f"📢 **وضعیت کانال‌های اختصاصی:**\n"
        f"{channels_text}\n"
        f"👇 از دکمه‌های شیشه‌ای زیر برای مدیریت ربات استفاده کنید:"
    )
    return text

async def download_telegram_file(bot: Bot, file_id: str, original_filename: Optional[str] = None) -> str:
    file = await bot.get_file(file_id)
    if not file.file_path:
        raise ValueError("Could not get file path from Telegram API")

    ext = os.path.splitext(file.file_path)[1]
    safe_name = Path(original_filename).name if original_filename else f"{uuid.uuid4().hex[:8]}{ext}"
    local_path = str(MEDIA_DIR / f"{uuid.uuid4().hex[:6]}_{safe_name}")
    await bot.download_file(file.file_path, destination=local_path)
    return local_path

async def dispatch_telegram_post(bot: Bot, message: Message, channel: ChannelProfile):
    """Processes a message from a recognized channel and forwards it."""
    post_id = str(message.message_id)
    source_name = f"@{message.chat.username}" if message.chat.username else channel.title

    # 1. Plain text
    if message.text and not (message.photo or message.video or message.document or message.voice or message.audio or message.animation):
        return await dispatcher.broadcast_for_channel(
            channel=channel,
            media_type="text",
            raw_text=message.text,
            source=source_name,
            post_id=post_id
        )

    # 2. Media posts
    caption = message.caption or ""
    media_type = None
    file_id = None
    file_name = None

    if message.photo:
        media_type = "photo"
        file_id = message.photo[-1].file_id
    elif message.video:
        media_type = "video"
        file_id = message.video.file_id
        file_name = message.video.file_name or "video.mp4"
    elif message.document:
        media_type = "document"
        file_id = message.document.file_id
        file_name = message.document.file_name or "document"
    elif message.voice:
        media_type = "voice"
        file_id = message.voice.file_id
        file_name = "voice.ogg"
    elif message.audio:
        media_type = "audio"
        file_id = message.audio.file_id
        file_name = message.audio.file_name or "audio.mp3"
    elif message.animation:
        media_type = "animation"
        file_id = message.animation.file_id
        file_name = message.animation.file_name or "animation.gif"

    if media_type and file_id:
        local_path = None
        try:
            local_path = await download_telegram_file(bot, file_id, file_name)
            return await dispatcher.broadcast_for_channel(
                channel=channel,
                media_type=media_type,
                file_path=local_path,
                caption=caption,
                file_name=file_name,
                source=source_name,
                post_id=post_id
            )
        finally:
            if local_path and os.path.exists(local_path):
                try:
                    os.remove(local_path)
                except Exception as e:
                    logger.warning(f"Could not remove temp file {local_path}: {e}")

# ==============================================================================
# CHANNEL POST HANDLER
# ==============================================================================

@router.channel_post()
async def on_channel_post(message: Message, bot: Bot):
    """Listens to channel posts and routes them to their matching destination."""
    chat_username = f"@{message.chat.username}" if message.chat.username else str(message.chat.id)
    matched_channel = config.get_channel_by_telegram_id(chat_username)

    if not matched_channel:
        logger.info(f"Ignored post from unrecognized channel: {chat_username}")
        return

    logger.info(f"Post detected from channel: {matched_channel.title} ({matched_channel.telegram_id})")

    # Album handling
    if message.media_group_id:
        async with album_lock:
            mg_id = message.media_group_id
            if mg_id not in album_buffer:
                async def _album_task():
                    await asyncio.sleep(1.5)
                    async with album_lock:
                        entry = album_buffer.pop(mg_id, None)
                    if entry:
                        for msg in entry["messages"]:
                            await dispatch_telegram_post(bot, msg, matched_channel)

                album_buffer[mg_id] = {"messages": [message], "task": asyncio.create_task(_album_task())}
            else:
                album_buffer[mg_id]["messages"].append(message)
        return

    # Single message
    await dispatch_telegram_post(bot, message, matched_channel)

# ==============================================================================
# ADMIN PV HANDLERS
# ==============================================================================

@router.message(Command("start", "admin", "menu", "status"))
async def cmd_admin_start(message: Message):
    if not is_authorized_admin(message.from_user):
        await message.reply(
            "⛔ **دسترسی غیرمجاز!**\n\n"
            "این ربات خصوصی بوده و فقط برای ادمین‌های مجاز قابل دسترس است.",
            parse_mode="Markdown"
        )
        return

    user_name = message.from_user.first_name or "ادمین"
    text = render_main_menu_text(user_name)
    kb = get_main_menu_keyboard()
    await message.reply(text, reply_markup=kb, parse_mode="Markdown")

@router.callback_query(F.data == "cb:main_menu")
async def cb_main_menu(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    user_name = call.from_user.first_name or "ادمین"
    text = render_main_menu_text(user_name)
    kb = get_main_menu_keyboard()
    try:
        await call.message.edit_text(text, reply_markup=kb, parse_mode="Markdown")
    except Exception:
        pass
    await call.answer()

@router.callback_query(F.data == "cb:toggle_global")
async def cb_toggle_global(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    is_paused = config.toggle_global_pause()
    status_label = "🔴 متوقف شد (Paused)" if is_paused else "🟢 فعال شد (Resumed)"
    await call.answer(f"سیستم با موفقیت {status_label}", show_alert=True)

    user_name = call.from_user.first_name or "ادمین"
    text = render_main_menu_text(user_name)
    kb = get_main_menu_keyboard()
    try:
        await call.message.edit_text(text, reply_markup=kb, parse_mode="Markdown")
    except Exception:
        pass

@router.callback_query(F.data == "cb:test_conns")
async def cb_test_connections(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    await call.answer("⏳ در حال بررسی اتصال به پیام‌رسان‌ها...")
    res = await dispatcher.test_all_connections()

    bale_icon = "🟢 متصل" if res.get("bale", {}).get("success") else f"🔴 خطا: {res.get('bale', {}).get('error', 'قطع')}"
    rubika_icon = "🟢 متصل" if res.get("rubika", {}).get("success") else f"🔴 خطا: {res.get('rubika', {}).get('error', 'قطع')}"
    eitaa_icon = "🟢 متصل" if res.get("eitaa", {}).get("success") else "⚪ تنظیم‌نشده یا غیرفعال"

    msg_text = (
        "📊 **نتیجه بررسی وضعیت پلتفرم‌ها:**\n\n"
        f"🔹 **بله (Bale):** {bale_icon}\n"
        f"🔹 **روبیکا (Rubika):** {rubika_icon}\n"
        f"🔹 **ایتا (Eitaa):** {eitaa_icon}\n\n"
        "برای بازگشت از دکمه زیر استفاده کنید:"
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 بازگشت به منوی اصلی", callback_data="cb:main_menu")]
    ])
    await call.message.edit_text(msg_text, reply_markup=kb, parse_mode="Markdown")

@router.callback_query(F.data.startswith("cb:ch:"))
async def cb_channel_details(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    ch_id = call.data.split(":")[2]
    matched = next((c for c in config.settings.channels if c.id == ch_id), None)
    if not matched:
        await call.answer("کانال یافت نشد", show_alert=True)
        return

    status_icon = "🟢 فعال" if matched.is_active else "🔴 غیرفعال"
    text = (
        f"📋 **اطلاعات و تنظیمات کانال: {matched.title}**\n\n"
        f"🔹 **وضعیت بازنشر:** {status_icon}\n\n"
        f"✈️ **کانال مبدأ تلگرام:** `{matched.telegram_id}`\n"
        f"🍃 **کانال مقصد بله:** `{matched.bale_id}`\n"
        f"🟣 **کانال مقصد روبیکا:** `{matched.rubika_id}`\n"
        f"🟠 **کانال مقصد ایتا:** `{matched.eitaa_id or 'تنظیم‌نشده'}`\n\n"
        f"👇 جهت تغییر وضعیت یا تست این کانال کلیک کنید:"
    )
    kb = get_channel_keyboard(matched)
    await call.message.edit_text(text, reply_markup=kb, parse_mode="Markdown")

@router.callback_query(F.data.startswith("cb:toggle_ch:"))
async def cb_toggle_channel(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    ch_id = call.data.split(":")[2]
    new_state = config.toggle_channel_pause(ch_id)
    state_str = "🟢 فعال" if new_state else "🔴 غیرفعال"
    await call.answer(f"وضعیت کانال به {state_str} تغییر یافت.", show_alert=True)

    matched = next((c for c in config.settings.channels if c.id == ch_id), None)
    if matched:
        kb = get_channel_keyboard(matched)
        status_icon = "🟢 فعال" if matched.is_active else "🔴 غیرفعال"
        text = (
            f"📋 **اطلاعات و تنظیمات کانال: {matched.title}**\n\n"
            f"🔹 **وضعیت بازنشر:** {status_icon}\n\n"
            f"✈️ **کانال مبدأ تلگرام:** `{matched.telegram_id}`\n"
            f"🍃 **کانال مقصد بله:** `{matched.bale_id}`\n"
            f"🟣 **کانال مقصد روبیکا:** `{matched.rubika_id}`\n"
            f"🟠 **کانال مقصد ایتا:** `{matched.eitaa_id or 'تنظیم‌نشده'}`\n\n"
            f"👇 جهت تغییر وضعیت یا تست این کانال کلیک کنید:"
        )
        try:
            await call.message.edit_text(text, reply_markup=kb, parse_mode="Markdown")
        except Exception:
            pass

@router.callback_query(F.data.startswith("cb:test_post:"))
async def cb_test_post(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    ch_id = call.data.split(":")[2]
    matched = next((c for c in config.settings.channels if c.id == ch_id), None)
    if not matched:
        await call.answer("کانال یافت نشد", show_alert=True)
        return

    await call.answer(f"⏳ در حال ارسال پست آزمایشی به {matched.title}...")
    test_text = f"این یک پیام آزمایشی برای کانال {matched.title} از ربات بازنشر چندپلتفرمه است."
    res = await dispatcher.broadcast_for_channel(
        channel=matched,
        media_type="text",
        raw_text=test_text,
        source=f"Admin Test (@{call.from_user.username})"
    )

    bale_s = "✅" if res.get("bale", {}).get("success") else "❌"
    rub_s = "✅" if res.get("rubika", {}).get("success") else "❌"
    eitaa_s = "✅" if res.get("eitaa", {}).get("success") else "⚪"

    await call.message.reply(
        f"📢 نتیجه ارسال تست به **{matched.title}**:\n\n"
        f"▫️ بله: {bale_s}\n"
        f"▫️ روبیکا: {rub_s}\n"
        f"▫️ ایتا: {eitaa_s}",
        parse_mode="Markdown"
    )

@router.callback_query(F.data == "cb:logs")
async def cb_view_logs(call: CallbackQuery):
    if not is_authorized_admin(call.from_user):
        await call.answer("دسترسی غیرمجاز", show_alert=True)
        return

    history = dispatcher.get_recent_history(5)
    if not history:
        msg_text = "📜 هنوز پیامی بازنشر نشده است."
    else:
        msg_text = "📜 **آخرین پیام‌های بازنشر شده:**\n\n"
        for item in history:
            b_s = "✅" if item["results"].get("bale", {}).get("success") else "❌"
            r_s = "✅" if item["results"].get("rubika", {}).get("success") else "❌"
            preview = item["content_preview"][:30] + "..." if len(item["content_preview"]) > 30 else item["content_preview"]
            msg_text += f"⏰ {item['timestamp']}\n📢 کانال: {item['channel_name']}\n💬 متن: {preview}\nنتیجه: بله: {b_s} | روبیکا: {r_s}\n────────────────\n"

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 بازگشت به منوی اصلی", callback_data="cb:main_menu")]
    ])
    await call.message.edit_text(msg_text, reply_markup=kb, parse_mode="Markdown")

# Direct Admin forward in PV
@router.message(F.chat.type == ChatType.PRIVATE)
async def on_private_message(message: Message):
    if not is_authorized_admin(message.from_user):
        await message.reply("⛔ دسترسی غیرمجاز!")
        return

    await message.reply(
        "💡 جهت مدیریت ربات، تغییر وضعیت کانال‌ها یا توقف و ادامه، از دستور /admin یا /menu استفاده کنید.",
        reply_markup=get_main_menu_keyboard()
    )

class TelegramBotManager:
    _instance: Optional["TelegramBotManager"] = None

    def __init__(self):
        self.bot: Optional[Bot] = None
        self.dp: Optional[AiogramDispatcher] = None
        self.is_running = False

    @classmethod
    def get_instance(cls) -> "TelegramBotManager":
        if cls._instance is None:
            cls._instance = TelegramBotManager()
        return cls._instance

    async def get_bot_info(self) -> Dict[str, Any]:
        token = config.settings.telegram_bot_token.strip()
        if not token:
            return {"configured": False, "connected": False, "error": "توکن ربات تلگرام وارد نشده است."}

        try:
            bot = Bot(token=token)
            me = await bot.get_me()
            await bot.session.close()
            return {
                "configured": True,
                "connected": True,
                "id": me.id,
                "username": me.username,
                "name": me.first_name
            }
        except Exception as e:
            return {"configured": True, "connected": False, "error": str(e)}

    async def start(self):
        token = config.settings.telegram_bot_token.strip()
        if not token:
            logger.warning("Telegram bot token is not configured.")
            return

        self.bot = Bot(token=token)
        self.dp = AiogramDispatcher()
        self.dp.include_router(router)

        logger.info("Starting Telegram bot listener...")
        self.is_running = True
        try:
            await self.bot.delete_webhook(drop_pending_updates=True)
            await self.dp.start_polling(self.bot, allowed_updates=["message", "channel_post", "callback_query"])
        except asyncio.CancelledError:
            logger.info("Telegram polling cancelled.")
        except Exception as e:
            logger.error(f"Error in Telegram polling: {e}", exc_info=True)
        finally:
            self.is_running = False
            if self.bot and self.bot.session:
                await self.bot.session.close()

    async def stop(self):
        self.is_running = False
        if self.dp:
            await self.dp.stop_polling()
        if self.bot and self.bot.session:
            await self.bot.session.close()

bot_manager = TelegramBotManager.get_instance()
