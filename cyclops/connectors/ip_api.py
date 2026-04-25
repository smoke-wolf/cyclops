import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class IpApiConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "IP-API"
        self.api_key = os.environ.get("IP_API_KEY")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})
        try:
            fields = "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,reverse,mobile,proxy,hosting,query"
            if self.api_key:
                url = f"https://pro.ip-api.com/json/{input_value}?key={self.api_key}&fields={fields}"
            else:
                url = f"http://ip-api.com/json/{input_value}?fields={fields}"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    data = await resp.json()
            entities = []
            if data.get("status") == "success":
                entities.append({"type": "ip", "data": {
                    "address": input_value, "country": data.get("country"), "country_code": data.get("countryCode"),
                    "region": data.get("regionName"), "city": data.get("city"), "lat": data.get("lat"), "lon": data.get("lon"),
                    "isp": data.get("isp"), "org": data.get("org"), "as": data.get("as"), "asname": data.get("asname"),
                    "reverse": data.get("reverse"), "is_proxy": data.get("proxy"), "is_mobile": data.get("mobile"),
                    "is_hosting": data.get("hosting"), "source": "ip_api",
                }, "confidence": 0.9})
                if data.get("org"):
                    entities.append({"type": "organization", "data": {"name": data["org"], "source": "ip_api"}, "confidence": 0.6})
                if data.get("reverse"):
                    entities.append({"type": "domain", "data": {"name": data["reverse"], "source": "ip_api_reverse"}, "confidence": 0.7,
                                     "as_known": {"type": "domain", "value": data["reverse"]}})
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
