import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class HaveIBeenPwnedConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "HaveIBeenPwned"
        self.api_key = os.environ.get("HIBP_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            entities = []
            headers = {"User-Agent": "CYCLOPS-OSINT", "Accept": "application/json"}
            if self.api_key:
                headers["hibp-api-key"] = self.api_key

            async with aiohttp.ClientSession(headers=headers) as session:
                url = f"https://haveibeenpwned.com/api/v3/breachedaccount/{input_value}?truncateResponse=false"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status == 404:
                        pass
                    elif resp.status == 401:
                        raise Exception("HIBP API key required (set HIBP_API_KEY)")
                    elif resp.status == 429:
                        raise Exception("HIBP rate limited")
                    elif resp.status >= 400:
                        raise Exception(f"HIBP HTTP {resp.status}")
                    else:
                        breaches = await resp.json()
                        for breach in breaches:
                            entities.append({
                                "type": "breach",
                                "data": {
                                    "name": breach["Name"],
                                    "domain": breach.get("Domain"),
                                    "date": breach.get("BreachDate"),
                                    "count": breach.get("PwnCount"),
                                    "data_classes": breach.get("DataClasses", []),
                                    "address": input_value,
                                    "source": "haveibeenpwned",
                                },
                                "confidence": 0.9,
                            })
                            if breach.get("Domain"):
                                entities.append({
                                    "type": "domain",
                                    "data": {"name": breach["Domain"], "source": "hibp_breach"},
                                    "confidence": 0.6,
                                })

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
