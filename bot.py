"""
Telegram bot (pyTelegramBotAPI / telebot) that launches the Mini App.
100% free bot: no payment commands, no ads.

Setup:
    1. Create a bot with @BotFather, get the token.
    2. Set env vars:
         BOT_TOKEN=xxxxx:yyyyy
         WEBAPP_URL=https://your-domain.example  (must be HTTPS, this is where server.py is hosted)
    3. In @BotFather, run /newapp or /setmenubutton to also attach the same
       WEBAPP_URL as the bot's persistent menu button (optional but recommended).
    4. python bot.py
"""
import os
import telebot
from telebot import types

BOT_TOKEN = os.environ.get("BOT_TOKEN", "PUT_YOUR_BOT_TOKEN_HERE")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://example.com")

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML")


@bot.message_handler(commands=["start"])
def start(message):
    markup = types.InlineKeyboardMarkup()
    markup.add(
        types.InlineKeyboardButton(
            text="🎮 Open Game Hub",
            web_app=types.WebAppInfo(url=WEBAPP_URL),
        )
    )
    bot.send_message(
        message.chat.id,
        "Welcome! 👋\n\n"
        "Tap the button below to open the Game Hub and play <b>Hokm</b> "
        "with friends or random players — completely free.",
        reply_markup=markup,
    )


@bot.message_handler(commands=["play"])
def play(message):
    start(message)


@bot.message_handler(commands=["help"])
def help_cmd(message):
    bot.send_message(
        message.chat.id,
        "Commands:\n"
        "/start - Open the Game Hub\n"
        "/play - Same as /start\n\n"
        "Inside the app you can:\n"
        "• Choose 2-player or 4-player Hokm\n"
        "• Invite a friend via a shareable link\n"
        "• Get matched randomly with other online players\n\n"
        "Everything is free — no purchases, no ads.",
    )


if __name__ == "__main__":
    print("Bot is running (long polling)...")
    bot.infinity_polling()
