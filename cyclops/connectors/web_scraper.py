import re
import aiohttp
from cyclops.connectors.base import BaseConnector


class WebScraperConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "WebScraper"

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            url = input_value if input_type == "url" else f"https://{input_value}"
            entities = []

            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=15), allow_redirects=True) as resp:
                    if resp.status >= 400:
                        raise Exception(f"HTTP {resp.status}")
                    html = await resp.text()

            emails = set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', html))
            for email in emails:
                if not any(x in email.lower() for x in ["example.com", "schema.org", "w3.org", "wixpress"]):
                    entities.append({"type": "email", "data": {"address": email.lower(), "source": "web_scraper"}, "confidence": 0.7,
                                     "as_known": {"type": "email", "value": email.lower()}})

            phones = set(re.findall(r'[\+]?[(]?[0-9]{1,4}[)]?[-\s\./0-9]{7,15}', html))
            for phone in list(phones)[:5]:
                digits = re.sub(r'\D', '', phone)
                if 7 <= len(digits) <= 15:
                    entities.append({"type": "phone", "data": {"number": phone.strip(), "source": "web_scraper"}, "confidence": 0.5})

            social_patterns = {
                "twitter": r'(?:twitter\.com|x\.com)/([a-zA-Z0-9_]{1,15})',
                "linkedin": r'linkedin\.com/(?:in|company)/([a-zA-Z0-9_-]+)',
                "github": r'github\.com/([a-zA-Z0-9_-]+)',
                "facebook": r'facebook\.com/([a-zA-Z0-9._-]+)',
                "instagram": r'instagram\.com/([a-zA-Z0-9._]+)',
            }
            for platform, pattern in social_patterns.items():
                matches = re.findall(pattern, html)
                for username in set(matches):
                    if username not in ("share", "intent", "home", "search", "about", "privacy", "terms"):
                        entities.append({"type": "account", "data": {"platform": platform, "username": username, "source": "web_scraper"}, "confidence": 0.6})

            tech_headers = {}
            server = resp.headers.get("Server")
            if server:
                tech_headers["server"] = server
            powered = resp.headers.get("X-Powered-By")
            if powered:
                tech_headers["powered_by"] = powered
            if tech_headers:
                entities.append({"type": "technology", "data": {"url": url, **tech_headers, "source": "web_scraper"}, "confidence": 0.8})

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
        return {"ok": True, "version": "native"}
