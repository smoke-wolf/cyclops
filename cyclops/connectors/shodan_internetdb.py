import aiohttp
from cyclops.connectors.base import BaseConnector


class ShodanInternetDBConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "Shodan InternetDB"

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            async with aiohttp.ClientSession() as session:
                async with session.get(f"https://internetdb.shodan.io/{input_value}", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 404:
                        data = None
                    elif resp.status >= 400:
                        raise Exception(f"InternetDB HTTP {resp.status}")
                    else:
                        data = await resp.json()
            if data:
                for port in data.get("ports", []):
                    entities.append({"type": "port", "data": {"number": port, "ip": input_value, "source": "shodan_internetdb"}, "confidence": 0.9})
                for hostname in data.get("hostnames", []):
                    entities.append({"type": "domain", "data": {"name": hostname, "source": "shodan_internetdb"}, "confidence": 0.8, "as_known": {"type": "domain", "value": hostname}})
                if data.get("vulns"):
                    entities.append({"type": "ip", "data": {"address": input_value, "vulns": data["vulns"], "ports": data.get("ports"), "cpes": data.get("cpes"), "source": "shodan_internetdb"}, "confidence": 0.9})
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
        return {"ok": True, "version": "free"}
