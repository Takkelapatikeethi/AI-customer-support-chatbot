USE chatbot_db;

ALTER TABLE chat_messages
    ADD COLUMN file_name VARCHAR(255) NULL,
    ADD COLUMN file_content MEDIUMTEXT NULL;
