# Gold Alert Bot

بات تلگرام برای بررسی قیمت طلای 18 عیار و سکه، محاسبه حباب سکه، و ارسال هشدار خرید/فروش.

## راه‌اندازی

1. فایل .env.example را به .env کپی کن.
2. مقدار TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID را پر کن.
3. دستور npm start را اجرا کن.

## تست بدون تلگرام

دستور npm run check یک گزارش فوری از قیمت، میانگین منابع، رفتار ذخیره‌شده، و حباب چاپ می‌کند.

## فرمان‌های تلگرام

- /start: شروع و نمایش وضعیت
- /check: بررسی فوری قیمت و حباب
- /settings: نمایش تنظیمات فعلی

## فرمول

تنظیمات مهم در فایل .env:

- TELEGRAM_BOT_TOKEN: توکن بات تلگرام
- TELEGRAM_CHAT_ID: مقصد پیام هشدار
- ENABLED_SOURCES: منابع فعال قیمت، فعلاً tgju,tala
- TRADINGVIEW_TICKERS: نمادهای TradingView برای سیگنال جهانی، پیش‌فرض TVC:GOLD,TVC:SILVER,OANDA:XAUUSD
- TRADINGVIEW_GOLD_TICKER: نماد مرجع طلا در TradingView، پیش‌فرض TVC:GOLD
- TRADINGVIEW_SILVER_TICKER: نماد مرجع نقره در TradingView، پیش‌فرض TVC:SILVER
- BUY_BUBBLE_PERCENT: آستانه خرید، پیش‌فرض منفی 5
- SELL_BUBBLE_PERCENT: آستانه فروش، پیش‌فرض مثبت 5
- HISTORY_FILE: فایل ذخیره تاریخچه برای تحلیل رفتار قیمت

ارزش ذاتی سکه از میانگین قیمت گرم طلای 18 عیار محاسبه می‌شود:

intrinsic = gold18Price * coinWeightGrams * (coinPurity / goldPricePurity)
bubble = coinMarketPrice - intrinsic
bubblePercent = bubble / intrinsic * 100

## TradingView

وقتی `tradingview` داخل `ENABLED_SOURCES` فعال باشد، بات از TradingView scanner برای
اونس جهانی طلا و نقره، درصد تغییر، RSI، میانگین‌های متحرک، و خلاصه تکنیکال ۱ساعته
و ۴ساعته استفاده می‌کند. این داده منبع اصلی قیمت داخلی ایران نیست؛ فقط لایه
سیگنال جهانی است تا جمع‌بندی خرید/فروش محتاط‌تر شود.
