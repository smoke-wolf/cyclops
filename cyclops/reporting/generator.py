import json
import os
from datetime import datetime, timezone
from html import escape
from pathlib import Path


class Reporter:
    def __init__(self, state):
        self.state = state
        self.output_dir = "/tmp/cyclops_runs"

    def generate(self, inv_id, fmt="json"):
        inv = self.state.get_investigation(inv_id)
        entities = self.state.get_entities(inv_id)
        knowns = self.state.get_knowns(inv_id)
        stats = self.state.get_stats(inv_id)
        links = self.state.get_links(inv_id)

        report_dir = os.path.join(self.output_dir, inv_id)
        os.makedirs(report_dir, exist_ok=True)

        data = {
            "meta": {
                "name": inv["name"],
                "workflow": inv["workflow"],
                "status": inv["status"],
                "created_at": inv["created_at"],
                "completed_at": inv["completed_at"],
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
            "knowns": [{"type": k["type"], "value": k["value"], "source": k["source"]} for k in knowns],
            "summary": {
                "entity_count": len(entities),
                "link_count": len(links),
                "types": {s["type"]: s["count"] for s in stats["entities"]},
            },
            "entities": [{"type": e["type"], "data": e["data"], "confidence": e["confidence"], "source_count": e["source_count"]} for e in entities],
            "links": [{"source_id": l["source_id"], "target_id": l["target_id"], "type": l["type"], "confidence": l["confidence"]} for l in links],
        }

        if fmt == "json":
            path = os.path.join(report_dir, "report.json")
            Path(path).write_text(json.dumps(data, indent=2))
        elif fmt == "html":
            path = os.path.join(report_dir, "report.html")
            Path(path).write_text(self._render_html(data))
        elif fmt == "markdown":
            path = os.path.join(report_dir, "report.md")
            Path(path).write_text(self._render_markdown(data))
        else:
            raise ValueError(f"Unknown format: {fmt}")

        return path

    def _render_html(self, data):
        meta = data["meta"]
        entities_html = ""
        for e in data["entities"]:
            entities_html += f"<tr><td>{escape(e['type'])}</td><td><pre>{escape(json.dumps(e['data'], indent=2))}</pre></td><td>{e['confidence']:.0%}</td></tr>\n"

        knowns_html = ""
        for k in data["knowns"]:
            knowns_html += f"<tr><td>{escape(k['type'])}</td><td>{escape(k['value'])}</td><td>{escape(k['source'])}</td></tr>\n"

        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>CYCLOPS — {escape(meta['name'])}</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 960px; margin: 2rem auto; background: #0d1117; color: #c9d1d9; padding: 0 1rem; }}
h1 {{ color: #f0883e; }} h2 {{ color: #58a6ff; border-bottom: 1px solid #21262d; padding-bottom: 0.5rem; }}
table {{ width: 100%; border-collapse: collapse; margin: 1rem 0; }}
th, td {{ padding: 0.5rem; border: 1px solid #30363d; text-align: left; }}
th {{ background: #161b22; }} tr:hover {{ background: #161b22; }}
pre {{ margin: 0; font-size: 0.85rem; white-space: pre-wrap; }}
.meta {{ background: #161b22; padding: 1rem; border-radius: 6px; margin: 1rem 0; }}
.meta span {{ margin-right: 2rem; }}
</style></head><body>
<h1>CYCLOPS</h1>
<div class="meta">
<span><b>Investigation:</b> {escape(meta['name'])}</span>
<span><b>Workflow:</b> {escape(meta['workflow'])}</span>
<span><b>Entities:</b> {data['summary']['entity_count']}</span>
<span><b>Links:</b> {data['summary']['link_count']}</span>
</div>
<h2>Knowns</h2>
<table><tr><th>Type</th><th>Value</th><th>Source</th></tr>{knowns_html}</table>
<h2>Entities ({data['summary']['entity_count']})</h2>
<table><tr><th>Type</th><th>Data</th><th>Confidence</th></tr>{entities_html}</table>
</body></html>"""

    def _render_markdown(self, data):
        meta = data["meta"]
        lines = [
            f"# CYCLOPS — {meta['name']}",
            f"\n**Workflow:** {meta['workflow']} | **Entities:** {data['summary']['entity_count']} | **Links:** {data['summary']['link_count']}",
            f"\n## Knowns\n",
            "| Type | Value | Source |",
            "|------|-------|--------|",
        ]
        for k in data["knowns"]:
            lines.append(f"| {k['type']} | {k['value']} | {k['source']} |")

        lines.append(f"\n## Entities ({data['summary']['entity_count']})\n")
        by_type = {}
        for e in data["entities"]:
            by_type.setdefault(e["type"], []).append(e)

        for t, ents in sorted(by_type.items()):
            lines.append(f"\n### {t} ({len(ents)})\n")
            for e in ents:
                conf = f"{e['confidence']:.0%}"
                summary = ", ".join(f"{k}: {v}" for k, v in e["data"].items() if v and k != "source")[:120]
                lines.append(f"- [{conf}] {summary}")

        return "\n".join(lines) + "\n"
