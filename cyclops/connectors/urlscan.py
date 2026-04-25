import os
import aiohttp
from urllib.parse import quote
from cyclops.connectors.base import BaseConnector


class URLScanConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "URLScan"
        self.api_key = os.environ.get("URLSCAN_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            headers = {"Accept": "application/json"}
            if self.api_key:
                headers["API-Key"] = self.api_key
            query = f"domain:{input_value}" if input_type == "domain" else f'page.url:"{input_value}"'
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(f"https://urlscan.io/api/v1/search/?q={quote(query)}&size=20", timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status >= 400:
                        raise Exception(f"URLScan HTTP {resp.status}")
                    data = await resp.json()
            seen_ips, seen_domains = set(), set()
            for scan in (data or {}).get("results", []):
                page = scan.get("page", {})
                if page.get("ip") and page["ip"] not in seen_ips:
                    seen_ips.add(page["ip"])
                    entities.append({"type": "ip", "data": {"address": page["ip"], "asn": page.get("asnname"), "country": page.get("country"), "server": page.get("server"), "source": "urlscan"}, "confidence": 0.8, "as_known": {"type": "ip", "value": page["ip"]}})
                if page.get("domain") and page["domain"] != input_value and page["domain"] not in seen_domains:
                    seen_domains.add(page["domain"])
                    entities.append({"type": "domain", "data": {"name": page["domain"], "source": "urlscan"}, "confidence": 0.7})
            new_count = 0
            for entity in entities:
                added = self.state.add_entity(investigation_id, entity["type"], entity["data"], entity.get("confidence", 0.5))
                if added["new"]:
                    new_count += 1
                self.telemetry.entity_discovered(investigation_id, entity["type"], added["new"], self.name)
                if "as_known" in entity:
                    self.state.add_known(investigation_id, entity["as_known"]["type"], entity["as_known"]["value"], self.name)
            self.state.complete_connector_run(run_id, "completed", new_count)
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "completed", "entitiesFound": new_count, "input": {"type": input_type, "value": input_value}})
            return {"status": "completed", "entities": entities, "newCount": new_count}
        except Exception as e:
            self.state.complete_connector_run(run_id, "failed", 0, error=str(e))
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "failed", "input": {"type": input_type, "value": input_value}})
            return {"status": "failed", "error": str(e)}

    async def health_check(self):
        return {"ok": True, "hasApiKey": bool(self.api_key)}
