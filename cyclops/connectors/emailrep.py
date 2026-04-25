import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class EmailRepConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "EmailRep"
        self.api_key = os.environ.get("EMAILREP_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            headers = {"User-Agent": "CYCLOPS-OSINT", "Accept": "application/json"}
            if self.api_key:
                headers["Key"] = self.api_key
            entities = []
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(f"https://emailrep.io/{input_value}", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 404:
                        pass
                    elif resp.status >= 400:
                        raise Exception(f"EmailRep HTTP {resp.status}")
                    else:
                        data = await resp.json()
                        entities.append({"type": "email", "data": {
                            "address": input_value, "reputation": data.get("reputation"), "suspicious": data.get("suspicious"),
                            "references": data.get("references"), "details": data.get("details"), "source": "emailrep",
                        }, "confidence": 0.8})
                        profiles = data.get("details", {}).get("profiles", [])
                        for p in profiles:
                            entities.append({"type": "account", "data": {"platform": p, "address": input_value, "source": "emailrep"}, "confidence": 0.7})
            new_count = 0
            for entity in entities:
                added = self.state.add_entity(investigation_id, entity["type"], entity["data"], entity.get("confidence", 0.5))
                if added["new"]:
                    new_count += 1
                self.telemetry.entity_discovered(investigation_id, entity["type"], added["new"], self.name)
            self.state.complete_connector_run(run_id, "completed", new_count)
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "completed", "entitiesFound": new_count, "input": {"type": input_type, "value": input_value}})
            return {"status": "completed", "entities": entities, "newCount": new_count}
        except Exception as e:
            self.state.complete_connector_run(run_id, "failed", 0, error=str(e))
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "failed", "input": {"type": input_type, "value": input_value}})
            return {"status": "failed", "error": str(e)}

    async def health_check(self):
        return {"ok": True, "hasApiKey": bool(self.api_key)}
