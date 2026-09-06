-- 059_ai_silence_handoff.sql — hand off auto-reply threads when the
-- customer goes silent after the bot's last message.
--
-- `silence_handoff_minutes` is account-scoped (next to the other
-- auto-reply tunables). 5 minutes is the default for a qualifier bot:
-- long enough to type, short enough that an advisor can still call.
-- 0 disables the sweep. The cron that already drains delayed
-- automations (`/api/automations/cron`) also runs the sweep.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS silence_handoff_minutes integer NOT NULL DEFAULT 5;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_silence_handoff_minutes_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_silence_handoff_minutes_check
  CHECK (silence_handoff_minutes >= 0 AND silence_handoff_minutes <= 30);
