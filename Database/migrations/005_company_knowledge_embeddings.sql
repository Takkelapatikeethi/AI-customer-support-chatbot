-- Portfolio-scale embedding storage. No changes to knowledge or chat tables.
USE chatbot_db;

CREATE TABLE IF NOT EXISTS company_knowledge_embeddings (
    knowledge_id BIGINT UNSIGNED NOT NULL,
    embedding_model VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    embedding JSON NOT NULL,
    embedding_dimensions SMALLINT UNSIGNED NOT NULL,
    content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    provider_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (knowledge_id, embedding_model),
    CONSTRAINT fk_company_embedding_knowledge FOREIGN KEY (knowledge_id)
        REFERENCES company_knowledge(id) ON DELETE CASCADE,
    CONSTRAINT chk_company_embedding_array CHECK (JSON_TYPE(embedding) = 'ARRAY'),
    CONSTRAINT chk_company_embedding_dimensions CHECK (
        embedding_dimensions BETWEEN 1 AND 16384
        AND JSON_LENGTH(embedding) = embedding_dimensions
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
