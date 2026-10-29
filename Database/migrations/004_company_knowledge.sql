-- Company policy/source content, not predefined chatbot questions and answers.
-- Additive migration only. Does not insert records or alter existing tables.
USE chatbot_db;

CREATE TABLE IF NOT EXISTS company_knowledge (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    keywords TEXT NULL,
    source_name VARCHAR(255) NOT NULL,
    source_url VARCHAR(2048) NULL,
    department VARCHAR(100) NOT NULL,
    access_level VARCHAR(64) NOT NULL DEFAULT 'employee',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT chk_company_knowledge_active CHECK (is_active IN (0, 1)),
    INDEX idx_company_knowledge_access_active_category
        (access_level, is_active, category),
    FULLTEXT INDEX ft_company_knowledge_text (title, content, keywords)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
