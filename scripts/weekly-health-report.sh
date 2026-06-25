#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/root/gold-alert-bot/.env"
SERVICE_NAME="gold-alert-bot.service"

read_env_value() {
  local key="$1"
  local line value
  line="$(grep -m1 "^${key}=" "$ENV_FILE" 2>/dev/null || true)"
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

CHAT_ID="${TELEGRAM_CHAT_ID:-$(read_env_value TELEGRAM_CHAT_ID)}"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(read_env_value TELEGRAM_BOT_TOKEN)}"

if [[ -z "$CHAT_ID" || -z "$BOT_TOKEN" ]]; then
  echo "Telegram token or chat id is missing" >&2
  exit 1
fi

service_state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
service_since="$(systemctl show "$SERVICE_NAME" -p ActiveEnterTimestamp --value 2>/dev/null || true)"
uptime_text="$(uptime -p 2>/dev/null || true)"
load_text="$(awk '{print $1 ", " $2 ", " $3}' /proc/loadavg 2>/dev/null || true)"
disk_line="$(df -h / | awk 'NR==2 {print "استفاده " $5 "، آزاد " $4 " از " $2}')"
memory_line="$(free -h | awk '/Mem:/ {print "استفاده " $3 " از " $2 "، آزاد " $7}')"
swap_line="$(free -h | awk '/Swap:/ {print "استفاده " $3 " از " $2}')"
warning_count="$(journalctl -u "$SERVICE_NAME" --since '7 days ago' -p warning..alert --no-pager 2>/dev/null | wc -l | tr -d ' ')"
restart_count="$(journalctl -u "$SERVICE_NAME" --since '7 days ago' --no-pager 2>/dev/null | grep -c 'Started Gold Alert Telegram Bot' || true)"
security_line="$(systemd-analyze security "$SERVICE_NAME" --no-pager 2>/dev/null | awk '/Overall exposure/ {print $(NF-2) " " $(NF-1)}' || true)"

if [[ "$service_state" == "active" ]]; then
  service_label="فعال"
else
  service_label="نیازمند بررسی: $service_state"
fi

report_date="$(date '+%Y-%m-%d %H:%M:%S %Z')"

message="$(cat <<TEXT
گزارش هفتگی سلامت نبض بازار

زمان گزارش: $report_date

وضعیت سرویس: $service_label
زمان آخرین فعال شدن: ${service_since:-نامشخص}

وضعیت سرور:
دیسک روت: $disk_line
رم: $memory_line
سواپ: $swap_line
فشار پردازنده: ${load_text:-نامشخص}
زمان روشن بودن سرور: ${uptime_text:-نامشخص}

هفت روز اخیر:
تعداد هشدارها و خطاهای سرویس: $warning_count
تعداد شروع دوباره سرویس: $restart_count

امنیت سرویس: ${security_line:-نامشخص}
TEXT
)"

curl --fail --silent --show-error \
  --data-urlencode "chat_id=$CHAT_ID" \
  --data-urlencode "text=$message" \
  --data-urlencode "disable_web_page_preview=true" \
  "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" >/dev/null
