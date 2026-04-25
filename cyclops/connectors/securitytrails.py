import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class SecurityTrailsConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "SecurityTrails"
        self.api_key = os.environ.get("SECURITYTRAILS_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        if not self.api_key:
            return {"status": "skipped", "error": "SECURITYTRAILS_API_KEY not set"}
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            headers = {"APIKEY": self.api_key, "Accept": "application/json"}
            async with aiohttp.ClientSession(headers=headers) as session:
                if input_type == "domain":
                    general = await self._get(session, f"/v1/domain/{input_value}")
                    if general and general.get("current_dns"):
                        dns = general["current_dns"]
                        for rtype in ("a", "aaaa", "mx", "ns", "txt", "soa"):
                            for rec in dns.get(rtype, {}).get("values", []):
                                value = rec.get("ip") or rec.get("value") or ""
                                if value:
                                    entities.append({"type": "dns_record", "data": {"type": rtype.upper(), "name": input_value, "value": value, "source": "securitytrails"}, "confidence": 0.9})
                                    if rtype in ("a", "aaaa"):
                                        entities.append({"type": "ip", "data": {"address": value, "source": "securitytrails_dns"}, "confidence": 0.9, "as_known": {"type": "ip", "value": value}})
                    subs = await self._get(session, f"/v1/domain/{input_value}/subdomains?children_only=false")
                    for sub in (subs or {}).get("subdomains", []):
                        fqdn = f"{sub}.{input_value}"
                        entities.append({"type": "subdomain", "data": {"name": fqdn, "parent_domain": input_value, "source": "securitytrails"}, "confidence": 0.9, "as_known": {"type": "domain", "value": fqdn}})
                elif input_type == "ip":
                    neighbors = await self._get(session, f"/v1/ips/nearby/{input_value}")
                    for block in (neighbors or {}).get("blocks", []):
                        for site in block.get("sites", []):
                            entities.append({"type": "domain", "data": {"name": site, "source": "securitytrails_ip_neighbors"}, "confidence": 0.5, "as_known": {"type": "domain", "value": site}})
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
        async with session.get(f"https://api.securitytrails.com{path}", timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status in (404, 429) or resp.status >= 400:
                return None
            return await resp.json()

    async def health_check(self):
        return {"ok": bool(self.api_key), "hasApiKey": bool(self.api_key)}
