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
- BUY_BUBBLE_PERCENT: آستانه خرید، پیش‌فرض منفی 5
- SELL_BUBBLE_PERCENT: آستانه فروش، پیش‌فرض مثبت 5
- HISTORY_FILE: فایل ذخیره تاریخچه برای تحلیل رفتار قیمت

ارزش ذاتی سکه از میانگین قیمت گرم طلای 18 عیار محاسبه می‌شود:

intrinsic = gold18Price * coinWeightGrams * (coinPurity / goldPricePurity)
bubble = coinMarketPrice - intrinsic
bubblePercent = bubble / intrinsic * 100
