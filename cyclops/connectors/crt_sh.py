import aiohttp
from cyclops.connectors.base import BaseConnector


class CrtShConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "crt.sh"

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            entities = []
            url = f"https://crt.sh/?q=%.{input_value}&output=json"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    if resp.status != 200:
                        raise Exception(f"crt.sh HTTP {resp.status}")
                    data = await resp.json(content_type=None)

            seen = set()
            for entry in (data or []):
                name = entry.get("name_value", "")
                for sub in name.split("\n"):
                    sub = sub.strip().lower().lstrip("*.")
                    if sub and sub != input_value and sub not in seen:
                        seen.add(sub)
                        entities.append({
                            "type": "subdomain",
                            "data": {"name": sub, "parent_domain": input_value, "source": "crt_sh"},
                            "confidence": 0.9,
                            "as_known": {"type": "domain", "value": sub},
                        })

                issuer = entry.get("issuer_name", "")
                if issuer:
                    entities.append({
                        "type": "certificate",
                        "data": {"subject": entry.get("common_name"), "issuer": issuer, "not_before": entry.get("not_before"), "not_after": entry.get("not_after"), "source": "crt_sh"},
                        "confidence": 0.85,
                    })

            seen_certs = set()
            deduped = []
            for e in entities:
                if e["type"] == "certificate":
                    key = e["data"].get("subject", "")
                    if key in seen_certs:
                        continue
                    seen_certs.add(key)
                deduped.append(e)

            new_count = 0
            for entity in deduped:
                added = self.state.add_entity(investigation_id, entity["type"], entity["data"], entity.get("confidence", 0.5))
                if added["new"]:
                    new_count += 1
                self.telemetry.entity_discovered(investigation_id, entity["type"], added["new"], self.name)
                if "as_known" in entity:
                    self.state.add_known(investigation_id, entity["as_known"]["type"], entity["as_known"]["value"], self.name)

            self.state.complete_connector_run(run_id, "completed", new_count)
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "completed", "entitiesFound": new_count, "input": {"type": input_type, "value": input_value}})
            return {"status": "completed", "entities": deduped, "newCount": new_count}
        except Exception as e:
            self.state.complete_connector_run(run_id, "failed", 0, error=str(e))
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "failed", "input": {"type": input_type, "value": input_value}})
            return {"status": "failed", "error": str(e)}

    async def health_check(self):
        return {"ok": True, "version": "free"}
