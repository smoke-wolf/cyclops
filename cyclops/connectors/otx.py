import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class OTXConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "AlienVault OTX"
        self.api_key = os.environ.get("OTX_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            headers = {"Accept": "application/json"}
            if self.api_key:
                headers["X-OTX-API-KEY"] = self.api_key
            async with aiohttp.ClientSession(headers=headers) as session:
                if input_type == "domain":
                    passive = await self._get(session, f"/api/v1/indicators/domain/{input_value}/passive_dns")
                    seen = set()
                    for rec in (passive or {}).get("passive_dns", [])[:30]:
                        addr = rec.get("address")
                        if addr and addr not in seen:
                            seen.add(addr)
                            entities.append({"type": "ip", "data": {"address": addr, "first_seen": rec.get("first"), "last_seen": rec.get("last"), "source": "otx_passive_dns"}, "confidence": 0.7, "as_known": {"type": "ip", "value": addr}})
                    general = await self._get(session, f"/api/v1/indicators/domain/{input_value}/general")
                    if general and general.get("pulse_info", {}).get("count", 0) > 0:
                        entities.append({"type": "domain", "data": {"name": input_value, "pulse_count": general["pulse_info"]["count"], "source": "otx"}, "confidence": 0.85})
                elif input_type == "ip":
                    general = await self._get(session, f"/api/v1/indicators/IPv4/{input_value}/general")
                    if general:
                        entities.append({"type": "ip", "data": {"address": input_value, "asn": general.get("asn"), "country": general.get("country_name"), "pulse_count": general.get("pulse_info", {}).get("count", 0), "source": "otx"}, "confidence": 0.85})
                    passive = await self._get(session, f"/api/v1/indicators/IPv4/{input_value}/passive_dns")
                    seen = set()
                    for rec in (passive or {}).get("passive_dns", [])[:30]:
                        hostname = rec.get("hostname")
                        if hostname and hostname not in seen:
                            seen.add(hostname)
                            entities.append({"type": "domain", "data": {"name": hostname, "source": "otx_passive_dns"}, "confidence": 0.7, "as_known": {"type": "domain", "value": hostname}})
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
        async with session.get(f"https://otx.alienvault.com{path}", timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status in (404, 429) or resp.status >= 400:
                return None
            return await resp.json()

    async def health_check(self):
        return {"ok": True, "hasApiKey": bool(self.api_key)}
