import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class AbuseIPDBConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "AbuseIPDB"
        self.api_key = os.environ.get("ABUSEIPDB_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        if not self.api_key:
            return {"status": "skipped", "error": "ABUSEIPDB_API_KEY not set"}
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            async with aiohttp.ClientSession(headers={"Key": self.api_key, "Accept": "application/json"}) as session:
                async with session.get(f"https://api.abuseipdb.com/api/v2/check?ipAddress={input_value}&maxAgeInDays=90&verbose", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status >= 400:
                        raise Exception(f"AbuseIPDB HTTP {resp.status}")
                    data = await resp.json()
            d = data.get("data", {})
            if d:
                entities.append({"type": "ip", "data": {"address": input_value, "abuse_score": d.get("abuseConfidenceScore"), "country": d.get("countryCode"),
                    "isp": d.get("isp"), "domain": d.get("domain"), "usage_type": d.get("usageType"), "is_tor": d.get("isTor"),
                    "total_reports": d.get("totalReports"), "last_reported": d.get("lastReportedAt"), "source": "abuseipdb"}, "confidence": 0.9})
                if d.get("domain"):
                    entities.append({"type": "domain", "data": {"name": d["domain"], "source": "abuseipdb"}, "confidence": 0.6, "as_known": {"type": "domain", "value": d["domain"]}})
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
        return {"ok": bool(self.api_key), "hasApiKey": bool(self.api_key)}
