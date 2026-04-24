-- Cyclops OSINT Pipeline — Core Schema

CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workflow TEXT NOT NULL DEFAULT 'person_full',
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, paused, completed, failed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    config TEXT DEFAULT '{}',  -- JSON: overrides for this investigation
    notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS knowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,  -- username, email, domain, ip, phone, name, url
    value TEXT NOT NULL,
    source TEXT DEFAULT 'user_input',
    confidence REAL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(investigation_id, type, value)
);

CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,  -- person, account, email, domain, subdomain, ip, port, etc.
    data TEXT NOT NULL DEFAULT '{}',  -- JSON: entity fields per schema
    fingerprint TEXT NOT NULL,  -- dedup hash of type + key fields
    confidence REAL DEFAULT 0.5,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    source_count INTEGER DEFAULT 1,
    UNIQUE(investigation_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    from_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    to_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    evidence TEXT DEFAULT '[]',  -- JSON array of source references
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(investigation_id, from_entity_id, to_entity_id, link_type)
);

CREATE TABLE IF NOT EXISTS connector_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    phase_id TEXT NOT NULL,
    connector TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, timeout, skipped
    input_type TEXT,
    input_value TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    entities_found INTEGER DEFAULT 0,
    raw_output TEXT,  -- compressed/truncated raw tool output
    error TEXT,
    exit_code INTEGER
);

CREATE TABLE IF NOT EXISTS phase_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    phase_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    entities_before INTEGER DEFAULT 0,
    entities_after INTEGER DEFAULT 0,
    UNIQUE(investigation_id, phase_id)
);

CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT,
    event_type TEXT NOT NULL,  -- connector_start, connector_end, phase_start, phase_end, entity_new, entity_link, error, warning
    connector TEXT,
    phase_id TEXT,
    data TEXT DEFAULT '{}',
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    format TEXT NOT NULL DEFAULT 'json',  -- json, html, pdf, markdown
    path TEXT,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    entity_count INTEGER DEFAULT 0,
    link_count INTEGER DEFAULT 0,
    summary TEXT DEFAULT ''
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowns_investigation ON knowns(investigation_id);
CREATE INDEX IF NOT EXISTS idx_entities_investigation ON entities(investigation_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(investigation_id, type);
CREATE INDEX IF NOT EXISTS idx_entities_fingerprint ON entities(fingerprint);
CREATE INDEX IF NOT EXISTS idx_links_investigation ON entity_links(investigation_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON entity_links(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON entity_links(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_connector_runs ON connector_runs(investigation_id, phase_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_investigation ON telemetry(investigation_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_type ON telemetry(event_type);
