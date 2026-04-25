import os
import base64
import aiohttp
from cyclops.connectors.base import BaseConnector


class VirusTotalConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "VirusTotal"
        self.api_key = os.environ.get("VIRUSTOTAL_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        if not self.api_key:
            return {"status": "skipped", "error": "VIRUSTOTAL_API_KEY not set"}
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            headers = {"x-apikey": self.api_key, "Accept": "application/json"}
            async with aiohttp.ClientSession(headers=headers) as session:
                if input_type == "domain":
                    data = await self._get(session, f"/api/v3/domains/{input_value}")
                    if data and data.get("data", {}).get("attributes"):
                        a = data["data"]["attributes"]
                        entities.append({"type": "domain", "data": {"name": input_value, "registrar": a.get("registrar"),
                            "reputation": a.get("reputation"), "malicious": (a.get("last_analysis_stats") or {}).get("malicious", 0),
                            "categories": a.get("categories"), "source": "virustotal"}, "confidence": 0.95})
                        for rec in a.get("last_dns_records") or []:
                            entities.append({"type": "dns_record", "data": {"type": rec["type"], "name": input_value, "value": rec.get("value"), "source": "virustotal"}, "confidence": 0.9})
                            if rec["type"] in ("A", "AAAA"):
                                entities.append({"type": "ip", "data": {"address": rec["value"], "source": "virustotal_dns"}, "confidence": 0.9, "as_known": {"type": "ip", "value": rec["value"]}})
                    subs = await self._get(session, f"/api/v3/domains/{input_value}/subdomains?limit=40")
                    for sub in (subs or {}).get("data", []):
                        entities.append({"type": "subdomain", "data": {"name": sub["id"], "parent_domain": input_value, "source": "virustotal"}, "confidence": 0.9, "as_known": {"type": "domain", "value": sub["id"]}})
                elif input_type == "ip":
                    data = await self._get(session, f"/api/v3/ip_addresses/{input_value}")
                    if data and data.get("data", {}).get("attributes"):
                        a = data["data"]["attributes"]
                        entities.append({"type": "ip", "data": {"address": input_value, "asn": a.get("asn"), "as_owner": a.get("as_owner"),
                            "country": a.get("country"), "reputation": a.get("reputation"), "source": "virustotal"}, "confidence": 0.95})
                elif input_type == "url":
                    url_id = base64.urlsafe_b64encode(input_value.encode()).decode().rstrip("=")
                    data = await self._get(session, f"/api/v3/urls/{url_id}")
                    if data and data.get("data", {}).get("attributes"):
                        a = data["data"]["attributes"]
                        entities.append({"type": "url", "data": {"url": input_value, "title": a.get("title"), "reputation": a.get("reputation"),
                            "malicious": (a.get("last_analysis_stats") or {}).get("malicious", 0), "source": "virustotal"}, "confidence": 0.9})
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

    async def _get(self, session, path):
        async with session.get(f"https://www.virustotal.com{path}", timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status in (404, 429) or resp.status >= 400:
                return None
            return await resp.json()

    async def health_check(self):
        return {"ok": bool(self.api_key), "hasApiKey": bool(self.api_key)}
