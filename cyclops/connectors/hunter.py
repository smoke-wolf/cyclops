import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class HunterConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "Hunter"
        self.api_key = os.environ.get("HUNTER_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        if not self.api_key:
            return {"status": "skipped", "error": "HUNTER_API_KEY not set"}
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            entities = []
            async with aiohttp.ClientSession() as session:
                if input_type == "domain":
                    async with session.get(f"https://api.hunter.io/v2/domain-search?domain={input_value}&api_key={self.api_key}", timeout=aiohttp.ClientTimeout(total=15)) as resp:
                        if resp.status >= 400:
                            raise Exception(f"Hunter HTTP {resp.status}")
                        data = await resp.json()
                    d = data.get("data", {})
                    if d.get("organization"):
                        entities.append({"type": "organization", "data": {"name": d["organization"], "source": "hunter"}, "confidence": 0.8})
                    for email_data in d.get("emails", []):
                        entities.append({"type": "email", "data": {
                            "address": email_data["value"], "type": email_data.get("type"),
                            "first_name": email_data.get("first_name"), "last_name": email_data.get("last_name"),
                            "position": email_data.get("position"), "department": email_data.get("department"),
                            "confidence": email_data.get("confidence"), "source": "hunter",
                        }, "confidence": (email_data.get("confidence", 50) / 100), "as_known": {"type": "email", "value": email_data["value"]}})
                        if email_data.get("first_name") and email_data.get("last_name"):
                            entities.append({"type": "person", "data": {"name": f"{email_data['first_name']} {email_data['last_name']}",
                                "position": email_data.get("position"), "source": "hunter"}, "confidence": 0.7})
                elif input_type == "email":
                    async with session.get(f"https://api.hunter.io/v2/email-verifier?email={input_value}&api_key={self.api_key}", timeout=aiohttp.ClientTimeout(total=15)) as resp:
                        if resp.status >= 400:
                            raise Exception(f"Hunter HTTP {resp.status}")
                        data = await resp.json()
                    d = data.get("data", {})
                    entities.append({"type": "email", "data": {"address": input_value, "result": d.get("result"), "score": d.get("score"),
                        "disposable": d.get("disposable"), "webmail": d.get("webmail"), "source": "hunter_verify"}, "confidence": 0.8})
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
