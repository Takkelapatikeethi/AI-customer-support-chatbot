USE chatbot_db;

-- Reject invalid ENUM values even when the connection uses non-strict SQL mode.
ALTER TABLE chat_messages ADD CONSTRAINT chk_message_role
    CHECK (role IN ('user', 'assistant', 'system'));

ALTER TABLE documents ADD CONSTRAINT chk_document_status
    CHECK (status IN ('pending', 'processing', 'ready', 'failed'));
