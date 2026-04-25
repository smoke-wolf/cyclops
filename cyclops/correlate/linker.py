import json
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "correlation.json"


def levenshtein(a, b):
    if len(a) < len(b):
        return levenshtein(b, a)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (0 if ca == cb else 1)))
        prev = curr
    return prev[-1]


def similarity(a, b):
    if not a or not b:
        return 0.0
    dist = levenshtein(a.lower(), b.lower())
    max_len = max(len(a), len(b))
    return 1 - (dist / max_len)


class Correlator:
    def __init__(self, state, telemetry):
        self.state = state
        self.telemetry = telemetry
        self.config = json.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
        self.threshold = self.config.get("fuzzy_threshold", 0.85)

    def correlate(self, inv_id):
        entities = self.state.get_entities(inv_id)
        links = []

        for i, e1 in enumerate(entities):
            for e2 in entities[i + 1:]:
                link = self._check_link(e1, e2)
                if link:
                    self.state.add_link(inv_id, e1["id"], e2["id"], link["type"], link["confidence"], link.get("evidence"))
                    links.append(link)

        self._apply_multi_source_bonus(inv_id)
        return links

    def _check_link(self, e1, e2):
        d1, d2 = e1["data"], e2["data"]

        if e1["type"] == "email" and e2["type"] == "account":
            if d1.get("address") and d1["address"] == d2.get("address"):
                return {"type": "email_to_account", "confidence": 0.95, "evidence": [{"rule": "exact_email_match"}]}

        if e1["type"] == "account" and e2["type"] == "email":
            if d1.get("address") and d1["address"] == d2.get("address"):
                return {"type": "account_to_email", "confidence": 0.95, "evidence": [{"rule": "exact_email_match"}]}

        if e1["type"] == "email" and e2["type"] == "breach":
            if d1.get("address") and d1["address"] == d2.get("address"):
                return {"type": "email_in_breach", "confidence": 0.9, "evidence": [{"rule": "email_breach_match"}]}

        if e1["type"] == "person" and e2["type"] == "account":
            u1 = d1.get("username", "")
            u2 = d2.get("username", "")
            if u1 and u2:
                sim = similarity(u1, u2)
                if sim >= self.threshold:
                    return {"type": "person_to_account", "confidence": sim, "evidence": [{"rule": "username_fuzzy", "similarity": sim}]}

        if e1["type"] == "account" and e2["type"] == "account":
            u1 = d1.get("username", "")
            u2 = d2.get("username", "")
            if u1 and u2 and d1.get("platform") != d2.get("platform"):
                sim = similarity(u1, u2)
                if sim >= self.threshold:
                    return {"type": "cross_platform", "confidence": sim * 0.8, "evidence": [{"rule": "username_fuzzy", "similarity": sim}]}

        if e1["type"] == "domain" and e2["type"] == "ip":
            return None
        if e1["type"] == "ip" and e2["type"] == "domain":
            return None

        if e1["type"] == "subdomain" and e2["type"] == "domain":
            if d1.get("name", "").endswith(f".{d2.get('name', '')}"):
                return {"type": "subdomain_of", "confidence": 1.0, "evidence": [{"rule": "parent_domain"}]}

        if e1["type"] == "domain" and e2["type"] == "subdomain":
            if d2.get("name", "").endswith(f".{d1.get('name', '')}"):
                return {"type": "has_subdomain", "confidence": 1.0, "evidence": [{"rule": "parent_domain"}]}

        return None

    def _apply_multi_source_bonus(self, inv_id):
        entities = self.state.get_entities(inv_id)
        for e in entities:
            if e["source_count"] >= 3 and e["confidence"] < 0.9:
                bonus = min(1.0, e["confidence"] + 0.1)
                self.state.db.execute("UPDATE entities SET confidence = ? WHERE id = ?", (bonus, e["id"]))
        self.state.db.commit()

    def build_graph(self, inv_id):
        entities = self.state.get_entities(inv_id)
        links = self.state.get_links(inv_id)

        nodes = []
        for e in entities:
            nodes.append({
                "id": e["id"],
                "type": e["type"],
                "label": self._entity_label(e),
                "confidence": e["confidence"],
            })

        edges = []
        for l in links:
            edges.append({
                "from": l["source_id"],
                "to": l["target_id"],
                "type": l["type"],
                "confidence": l["confidence"],
            })

        return {"nodes": nodes, "edges": edges}

    def _entity_label(self, entity):
        d = entity["data"]
        t = entity["type"]
        labels = {
            "email": lambda: d.get("address", ""),
            "account": lambda: f"{d.get('platform', '')}:{d.get('username', '')}",
            "person": lambda: d.get("name") or d.get("username", ""),
            "domain": lambda: d.get("name", ""),
            "subdomain": lambda: d.get("name", ""),
            "ip": lambda: d.get("address", ""),
            "port": lambda: f"{d.get('ip', '')}:{d.get('number', '')}",
            "certificate": lambda: d.get("subject", ""),
            "breach": lambda: d.get("name", ""),
            "phone": lambda: d.get("number", ""),
            "url": lambda: d.get("url", ""),
            "dns_record": lambda: f"{d.get('type', '')} {d.get('value', '')}",
            "repository": lambda: d.get("name") or d.get("url", ""),
            "organization": lambda: d.get("name", ""),
            "technology": lambda: ", ".join(d.get("technologies", [])) if d.get("technologies") else d.get("url", ""),
        }
        return labels.get(t, lambda: str(d))()
