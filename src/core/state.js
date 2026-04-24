import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'db', 'schema.sql');

export class State {
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this._initSchema();
    }

    _initSchema() {
        const schema = readFileSync(SCHEMA_PATH, 'utf-8');
        this.db.exec(schema);
    }

    createInvestigation(name, workflow = 'person_full', config = {}) {
        const id = randomUUID().split('-')[0];
        this.db.prepare(`
            INSERT INTO investigations (id, name, workflow, status, config)
            VALUES (?, ?, ?, 'pending', ?)
        `).run(id, name, workflow, JSON.stringify(config));
        return id;
    }

    getInvestigation(id) {
        const row = this.db.prepare('SELECT * FROM investigations WHERE id = ?').get(id);
        if (row) row.config = JSON.parse(row.config || '{}');
        return row;
    }

    listInvestigations(status = null) {
        if (status) {
            return this.db.prepare('SELECT * FROM investigations WHERE status = ? ORDER BY created_at DESC').all(status);
        }
        return this.db.prepare('SELECT * FROM investigations ORDER BY created_at DESC').all();
    }

    updateInvestigationStatus(id, status) {
        const updates = { status, updated_at: new Date().toISOString() };
        if (status === 'completed' || status === 'failed') {
            updates.completed_at = new Date().toISOString();
        }
        this.db.prepare(`
            UPDATE investigations SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at)
            WHERE id = ?
        `).run(status, updates.updated_at, updates.completed_at || null, id);
    }

    addKnown(investigationId, type, value, source = 'user_input', confidence = 1.0) {
        return this.db.prepare(`
            INSERT OR IGNORE INTO knowns (investigation_id, type, value, source, confidence)
            VALUES (?, ?, ?, ?, ?)
        `).run(investigationId, type, value.trim().toLowerCase(), source, confidence);
    }

    getKnowns(investigationId, type = null) {
        if (type) {
            return this.db.prepare('SELECT * FROM knowns WHERE investigation_id = ? AND type = ?').all(investigationId, type);
        }
        return this.db.prepare('SELECT * FROM knowns WHERE investigation_id = ?').all(investigationId);
    }

    entityFingerprint(type, data) {
        const keyFields = {
            person: ['name', 'username', 'email'],
            account: ['platform', 'username'],
            email: ['address'],
            domain: ['name'],
            subdomain: ['name'],
            ip: ['address'],
            port: ['number', 'address'],
            certificate: ['fingerprint'],
            breach: ['name', 'source'],
            credential: ['email', 'source_breach'],
            phone: ['number'],
            url: ['url'],
            dns_record: ['type', 'name', 'value']
        };
        const fields = keyFields[type] || Object.keys(data);
        const key = fields.map(f => data[f] || '').join('|');
        return createHash('sha256').update(`${type}:${key}`).digest('hex').slice(0, 16);
    }

    addEntity(investigationId, type, data, confidence = 0.5) {
        const fingerprint = this.entityFingerprint(type, data);
        const existing = this.db.prepare(
            'SELECT id, source_count, confidence FROM entities WHERE investigation_id = ? AND fingerprint = ?'
        ).get(investigationId, fingerprint);

        if (existing) {
            const newConfidence = Math.min(1.0, existing.confidence + 0.1);
            this.db.prepare(`
                UPDATE entities SET source_count = source_count + 1, confidence = ?,
                last_seen = datetime('now'), data = ? WHERE id = ?
            `).run(newConfidence, JSON.stringify(data), existing.id);
            return { id: existing.id, new: false };
        }

        const result = this.db.prepare(`
            INSERT INTO entities (investigation_id, type, data, fingerprint, confidence)
            VALUES (?, ?, ?, ?, ?)
        `).run(investigationId, type, JSON.stringify(data), fingerprint, confidence);
        return { id: result.lastInsertRowid, new: true };
    }

    getEntities(investigationId, type = null) {
        let rows;
        if (type) {
            rows = this.db.prepare('SELECT * FROM entities WHERE investigation_id = ? AND type = ?').all(investigationId, type);
        } else {
            rows = this.db.prepare('SELECT * FROM entities WHERE investigation_id = ?').all(investigationId);
        }
        return rows.map(r => ({ ...r, data: JSON.parse(r.data || '{}') }));
    }

    addLink(investigationId, fromId, toId, linkType, confidence = 0.5, evidence = []) {
        return this.db.prepare(`
            INSERT OR IGNORE INTO entity_links (investigation_id, from_entity_id, to_entity_id, link_type, confidence, evidence)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(investigationId, fromId, toId, linkType, confidence, JSON.stringify(evidence));
    }

    getLinks(investigationId, entityId = null) {
        if (entityId) {
            return this.db.prepare(`
                SELECT * FROM entity_links
                WHERE investigation_id = ? AND (from_entity_id = ? OR to_entity_id = ?)
            `).all(investigationId, entityId, entityId);
        }
        return this.db.prepare('SELECT * FROM entity_links WHERE investigation_id = ?').all(investigationId);
    }

    recordConnectorRun(investigationId, phaseId, connector, inputType, inputValue) {
        const result = this.db.prepare(`
            INSERT INTO connector_runs (investigation_id, phase_id, connector, input_type, input_value, status, started_at)
            VALUES (?, ?, ?, ?, ?, 'running', datetime('now'))
        `).run(investigationId, phaseId, connector, inputType, inputValue);
        return result.lastInsertRowid;
    }

    completeConnectorRun(runId, status, entitiesFound, rawOutput = null, error = null, exitCode = null) {
        this.db.prepare(`
            UPDATE connector_runs
            SET status = ?, completed_at = datetime('now'),
                duration_ms = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400000 AS INTEGER),
                entities_found = ?, raw_output = ?, error = ?, exit_code = ?
            WHERE id = ?
        `).run(status, entitiesFound, rawOutput, error, exitCode, runId);
    }

    recordPhaseRun(investigationId, phaseId) {
        const entityCount = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM entities WHERE investigation_id = ?'
        ).get(investigationId).cnt;

        this.db.prepare(`
            INSERT OR REPLACE INTO phase_runs (investigation_id, phase_id, status, started_at, entities_before)
            VALUES (?, ?, 'running', datetime('now'), ?)
        `).run(investigationId, phaseId, entityCount);
    }

    completePhaseRun(investigationId, phaseId, status) {
        const entityCount = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM entities WHERE investigation_id = ?'
        ).get(investigationId).cnt;

        this.db.prepare(`
            UPDATE phase_runs SET status = ?, completed_at = datetime('now'), entities_after = ?
            WHERE investigation_id = ? AND phase_id = ?
        `).run(status, entityCount, investigationId, phaseId);
    }

    logTelemetry(investigationId, eventType, data = {}, connector = null, phaseId = null) {
        this.db.prepare(`
            INSERT INTO telemetry (investigation_id, event_type, connector, phase_id, data)
            VALUES (?, ?, ?, ?, ?)
        `).run(investigationId, eventType, connector, phaseId, JSON.stringify(data));
    }

    getStats(investigationId) {
        const entities = this.db.prepare(
            'SELECT type, COUNT(*) as count FROM entities WHERE investigation_id = ? GROUP BY type'
        ).all(investigationId);
        const links = this.db.prepare(
            'SELECT COUNT(*) as count FROM entity_links WHERE investigation_id = ?'
        ).get(investigationId);
        const connectors = this.db.prepare(
            'SELECT connector, status, COUNT(*) as count FROM connector_runs WHERE investigation_id = ? GROUP BY connector, status'
        ).all(investigationId);
        const phases = this.db.prepare(
            'SELECT * FROM phase_runs WHERE investigation_id = ? ORDER BY started_at'
        ).all(investigationId);

        return { entities, links: links.count, connectors, phases };
    }

    close() {
        this.db.close();
    }
}
