
USE chatbot_db;

-- For the original Users table, first run migrations/001_normalize_users_table.sql.
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Store questions and responses as separate messages.
CREATE TABLE IF NOT EXISTS chat_messages (
    message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    role ENUM('user', 'assistant', 'system') NOT NULL,
    content LONGTEXT NOT NULL,
    file_name VARCHAR(255) NULL,
    file_content MEDIUMTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_messages_session FOREIGN KEY (session_id)
        REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    CONSTRAINT chk_message_role CHECK (role IN ('user', 'assistant', 'system')),
    INDEX idx_messages_session_order (session_id, created_at, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
    document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uploaded_by INT NULL,
    title VARCHAR(255) NOT NULL,
    source_uri TEXT COMMENT 'File path, storage key, or source URL',
    mime_type VARCHAR(100),
    content LONGTEXT,
    status ENUM('pending', 'processing', 'ready', 'failed')
        NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_documents_user FOREIGN KEY (uploaded_by)
        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_document_status
        CHECK (status IN ('pending', 'processing', 'ready', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The backend must verify that feedback targets an assistant response
-- in the submitting user's session.
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    thumbs_up BOOLEAN NULL COMMENT '1 = thumbs-up; 0 = thumbs-down',
    rating TINYINT UNSIGNED NULL,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_feedback_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_feedback_message FOREIGN KEY (message_id)
        REFERENCES chat_messages(message_id) ON DELETE CASCADE,
    CONSTRAINT chk_feedback_thumbs
        CHECK (thumbs_up IS NULL OR thumbs_up IN (0, 1)),
    CONSTRAINT chk_feedback_rating
        CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT chk_feedback_value
        CHECK (thumbs_up IS NOT NULL OR rating IS NOT NULL),
    CONSTRAINT uq_feedback_user_message UNIQUE (user_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
