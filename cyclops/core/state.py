import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone


class State:
    def __init__(self, db_path=":memory:"):
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self._init_tables()

    def _init_tables(self):
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS investigations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                workflow TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS knowns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                investigation_id TEXT NOT NULL,
                type TEXT NOT NULL,
                value TEXT NOT NULL,
                source TEXT DEFAULT 'seed',
                confidence REAL DEFAULT 1.0,
                FOREIGN KEY(investigation_id) REFERENCES investigations(id)
            );
            CREATE TABLE IF NOT EXISTS entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                investigation_id TEXT NOT NULL,
                type TEXT NOT NULL,
                data TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                confidence REAL DEFAULT 0.5,
                source_count INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY(investigation_id) REFERENCES investigations(id)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_fp
                ON entities(investigation_id, fingerprint);
            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                investigation_id TEXT NOT NULL,
                source_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                confidence REAL DEFAULT 0.5,
                evidence TEXT,
                FOREIGN KEY(investigation_id) REFERENCES investigations(id)
            );
            CREATE TABLE IF NOT EXISTS connector_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                investigation_id TEXT NOT NULL,
                phase_id TEXT,
                connector TEXT NOT NULL,
                input_type TEXT,
                input_value TEXT,
                status TEXT DEFAULT 'running',
                entities_found INTEGER DEFAULT 0,
                raw_output TEXT,
                error TEXT,
                errors INTEGER DEFAULT 0,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY(investigation_id) REFERENCES investigations(id)
            );
        """)

    def create_investigation(self, name, workflow):
        inv_id = uuid.uuid4().hex[:8]
        now = datetime.now(timezone.utc).isoformat()
        self.db.execute(
            "INSERT INTO investigations (id, name, workflow, created_at) VALUES (?, ?, ?, ?)",
            (inv_id, name, workflow, now),
        )
        self.db.commit()
        return inv_id

    def get_investigation(self, inv_id):
        row = self.db.execute("SELECT * FROM investigations WHERE id = ?", (inv_id,)).fetchone()
        return dict(row) if row else None

    def list_investigations(self, status=None):
        if status:
            rows = self.db.execute("SELECT * FROM investigations WHERE status = ? ORDER BY created_at DESC", (status,)).fetchall()
        else:
            rows = self.db.execute("SELECT * FROM investigations ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    def update_investigation_status(self, inv_id, status):
        completed = datetime.now(timezone.utc).isoformat() if status in ("completed", "failed", "aborted") else None
        self.db.execute(
            "UPDATE investigations SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?",
            (status, completed, inv_id),
        )
        self.db.commit()

    def add_known(self, inv_id, type_, value, source="seed", confidence=1.0):
        value = value.lower().strip()
        self.db.execute(
            "INSERT INTO knowns (investigation_id, type, value, source, confidence) VALUES (?, ?, ?, ?, ?)",
            (inv_id, type_, value, source, confidence),
        )
        self.db.commit()

    def get_knowns(self, inv_id, type_=None):
        if type_:
            rows = self.db.execute("SELECT * FROM knowns WHERE investigation_id = ? AND type = ?", (inv_id, type_)).fetchall()
        else:
            rows = self.db.execute("SELECT * FROM knowns WHERE investigation_id = ?", (inv_id,)).fetchall()
        return [dict(r) for r in rows]

    def entity_fingerprint(self, type_, data):
        key_fields = {
            "email": ["address"],
            "account": ["platform", "username"],
            "person": ["name", "username"],
            "domain": ["name"],
            "subdomain": ["name"],
            "ip": ["address"],
            "port": ["number", "ip"],
            "certificate": ["subject", "issuer"],
            "breach": ["name"],
            "credential": ["username", "password"],
            "phone": ["number"],
            "url": ["url"],
            "dns_record": ["type", "name", "value"],
            "repository": ["name"],
            "organization": ["name"],
            "technology": ["url"],
        }
        fields = key_fields.get(type_, sorted(data.keys()))
        fp_data = {f: data.get(f, "") for f in fields}
        raw = f"{type_}:{json.dumps(fp_data, sort_keys=True)}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def add_entity(self, inv_id, type_, data, confidence=0.5):
        fp = self.entity_fingerprint(type_, data)
        existing = self.db.execute(
            "SELECT id, confidence, source_count FROM entities WHERE investigation_id = ? AND fingerprint = ?",
            (inv_id, fp),
        ).fetchone()

        if existing:
            new_conf = min(1.0, existing["confidence"] + (1 - existing["confidence"]) * 0.15)
            new_count = existing["source_count"] + 1
            self.db.execute(
                "UPDATE entities SET confidence = ?, source_count = ? WHERE id = ?",
                (new_conf, new_count, existing["id"]),
            )
            self.db.commit()
            return {"id": existing["id"], "new": False, "confidence": new_conf}

        now = datetime.now(timezone.utc).isoformat()
        cur = self.db.execute(
            "INSERT INTO entities (investigation_id, type, data, fingerprint, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (inv_id, type_, json.dumps(data), fp, confidence, now),
        )
        self.db.commit()
        return {"id": cur.lastrowid, "new": True, "confidence": confidence}

    def get_entities(self, inv_id, type_=None):
        if type_:
            rows = self.db.execute("SELECT * FROM entities WHERE investigation_id = ? AND type = ?", (inv_id, type_)).fetchall()
        else:
            rows = self.db.execute("SELECT * FROM entities WHERE investigation_id = ?", (inv_id,)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["data"] = json.loads(d["data"])
            results.append(d)
        return results

    def add_link(self, inv_id, source_id, target_id, type_, confidence=0.5, evidence=None):
        self.db.execute(
            "INSERT INTO links (investigation_id, source_id, target_id, type, confidence, evidence) VALUES (?, ?, ?, ?, ?, ?)",
            (inv_id, source_id, target_id, type_, confidence, json.dumps(evidence) if evidence else None),
        )
        self.db.commit()

    def get_links(self, inv_id, entity_id=None):
        if entity_id:
            rows = self.db.execute(
                "SELECT * FROM links WHERE investigation_id = ? AND (source_id = ? OR target_id = ?)",
                (inv_id, entity_id, entity_id),
            ).fetchall()
        else:
            rows = self.db.execute("SELECT * FROM links WHERE investigation_id = ?", (inv_id,)).fetchall()
        return [dict(r) for r in rows]

    def record_connector_run(self, inv_id, phase_id, connector, input_type, input_value):
        now = datetime.now(timezone.utc).isoformat()
        cur = self.db.execute(
            "INSERT INTO connector_runs (investigation_id, phase_id, connector, input_type, input_value, started_at) VALUES (?, ?, ?, ?, ?, ?)",
            (inv_id, phase_id, connector, input_type, input_value, now),
        )
        self.db.commit()
        return cur.lastrowid

    def complete_connector_run(self, run_id, status, entities_found, raw_output=None, error=None, errors=0):
        now = datetime.now(timezone.utc).isoformat()
        self.db.execute(
            "UPDATE connector_runs SET status = ?, entities_found = ?, raw_output = ?, error = ?, errors = ?, completed_at = ? WHERE id = ?",
            (status, entities_found, raw_output, error, errors, now, run_id),
        )
        self.db.commit()

    def get_stats(self, inv_id):
        entity_rows = self.db.execute(
            "SELECT type, COUNT(*) as count FROM entities WHERE investigation_id = ? GROUP BY type",
            (inv_id,),
        ).fetchall()
        connector_rows = self.db.execute(
            "SELECT * FROM connector_runs WHERE investigation_id = ?", (inv_id,)
        ).fetchall()
        link_count = self.db.execute(
            "SELECT COUNT(*) FROM links WHERE investigation_id = ?", (inv_id,)
        ).fetchone()[0]
        phase_rows = self.db.execute(
            "SELECT DISTINCT phase_id FROM connector_runs WHERE investigation_id = ?", (inv_id,)
        ).fetchall()
        return {
            "entities": [dict(r) for r in entity_rows],
            "connectors": [dict(r) for r in connector_rows],
            "links": link_count,
            "phases": [r["phase_id"] for r in phase_rows],
        }

    def close(self):
        self.db.close()
