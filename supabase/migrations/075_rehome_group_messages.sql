-- ============================================================
-- 075_rehome_group_messages.sql
--
-- Group messages were stored on the *participant's* 1:1 thread because
-- WAHA puts the sender in `from` and the group only in `message_id`
-- (`false_{group}@g.us_{id}`). Move those rows onto one conversation
-- per group JID and mark the contact as a WhatsApp group.
-- ============================================================

DO $$
DECLARE
  r RECORD;
  v_contact_id UUID;
  v_conv_id UUID;
  v_phone TEXT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _rehomed_convs (id UUID PRIMARY KEY) ON COMMIT DROP;

  FOR r IN
    SELECT DISTINCT
      conv.account_id,
      conv.user_id,
      (regexp_match(m.message_id, '((?:\d+-)?\d{5,}@g\.us)'))[1] AS group_jid
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id
    WHERE m.message_id ~ '@g\.us'
      AND (regexp_match(m.message_id, '((?:\d+-)?\d{5,}@g\.us)'))[1] IS NOT NULL
  LOOP
    v_phone := regexp_replace(r.group_jid, '\D', '', 'g');
    v_contact_id := NULL;
    v_conv_id := NULL;

    SELECT c.id INTO v_contact_id
    FROM contacts c
    WHERE c.account_id = r.account_id
      AND c.whatsapp_jid = r.group_jid
    LIMIT 1;

    IF v_contact_id IS NULL THEN
      BEGIN
        INSERT INTO contacts (
          account_id,
          user_id,
          phone,
          name,
          whatsapp_jid,
          is_whatsapp_group
        ) VALUES (
          r.account_id,
          r.user_id,
          v_phone,
          'Grupo',
          r.group_jid,
          true
        )
        RETURNING id INTO v_contact_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT c.id INTO v_contact_id
        FROM contacts c
        WHERE c.account_id = r.account_id
          AND (
            c.whatsapp_jid = r.group_jid
            OR c.phone_normalized = v_phone
          )
        ORDER BY CASE WHEN c.whatsapp_jid = r.group_jid THEN 0 ELSE 1 END
        LIMIT 1;

        IF v_contact_id IS NOT NULL THEN
          UPDATE contacts
          SET
            is_whatsapp_group = true,
            whatsapp_jid = COALESCE(whatsapp_jid, r.group_jid),
            updated_at = NOW()
          WHERE id = v_contact_id;
        END IF;
      END;
    ELSE
      UPDATE contacts
      SET is_whatsapp_group = true, updated_at = NOW()
      WHERE id = v_contact_id AND is_whatsapp_group IS DISTINCT FROM true;
    END IF;

    IF v_contact_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT conv.id INTO v_conv_id
    FROM conversations conv
    WHERE conv.account_id = r.account_id
      AND conv.contact_id = v_contact_id
    ORDER BY conv.created_at ASC
    LIMIT 1;

    IF v_conv_id IS NULL THEN
      BEGIN
        INSERT INTO conversations (
          account_id,
          user_id,
          contact_id,
          status
        ) VALUES (
          r.account_id,
          r.user_id,
          v_contact_id,
          'open'
        )
        RETURNING id INTO v_conv_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT conv.id INTO v_conv_id
        FROM conversations conv
        WHERE conv.account_id = r.account_id
          AND conv.contact_id = v_contact_id
        ORDER BY conv.created_at ASC
        LIMIT 1;
      END;
    END IF;

    IF v_conv_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO _rehomed_convs (id) VALUES (v_conv_id) ON CONFLICT DO NOTHING;

    INSERT INTO _rehomed_convs (id)
    SELECT DISTINCT m.conversation_id
    FROM messages m
    WHERE (regexp_match(m.message_id, '((?:\d+-)?\d{5,}@g\.us)'))[1] = r.group_jid
      AND m.conversation_id IS DISTINCT FROM v_conv_id
    ON CONFLICT DO NOTHING;

    UPDATE messages m
    SET conversation_id = v_conv_id
    WHERE (regexp_match(m.message_id, '((?:\d+-)?\d{5,}@g\.us)'))[1] = r.group_jid
      AND m.conversation_id IS DISTINCT FROM v_conv_id
      AND NOT EXISTS (
        SELECT 1
        FROM messages x
        WHERE x.conversation_id = v_conv_id
          AND x.message_id = m.message_id
      );

    DELETE FROM messages m
    WHERE (regexp_match(m.message_id, '((?:\d+-)?\d{5,}@g\.us)'))[1] = r.group_jid
      AND m.conversation_id IS DISTINCT FROM v_conv_id;
  END LOOP;

  UPDATE conversations conv
  SET
    last_message_text = sub.content_text,
    last_message_at = sub.created_at,
    updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      COALESCE(m.content_text, '[' || m.content_type || ']') AS content_text,
      m.created_at
    FROM messages m
    JOIN _rehomed_convs a ON a.id = m.conversation_id
    ORDER BY m.conversation_id, m.created_at DESC
  ) sub
  WHERE conv.id = sub.conversation_id;
END $$;
