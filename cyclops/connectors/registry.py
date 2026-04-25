import json
from pathlib import Path

from cyclops.connectors.base import BinaryConnector
from cyclops.connectors.github import GitHubConnector
from cyclops.connectors.dns_native import DnsNativeConnector
from cyclops.connectors.whois_native import WhoisNativeConnector
from cyclops.connectors.crt_sh import CrtShConnector
from cyclops.connectors.haveibeenpwned import HaveIBeenPwnedConnector
from cyclops.connectors.web_scraper import WebScraperConnector
from cyclops.connectors.wayback import WaybackConnector
from cyclops.connectors.ip_api import IpApiConnector
from cyclops.connectors.emailrep import EmailRepConnector
from cyclops.connectors.virustotal import VirusTotalConnector
from cyclops.connectors.hunter import HunterConnector
from cyclops.connectors.securitytrails import SecurityTrailsConnector
from cyclops.connectors.shodan_internetdb import ShodanInternetDBConnector
from cyclops.connectors.otx import OTXConnector
from cyclops.connectors.abuseipdb import AbuseIPDBConnector
from cyclops.connectors.urlscan import URLScanConnector

CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "connectors.json"

CONNECTOR_MAP = {
    "github": GitHubConnector,
    "dns_native": DnsNativeConnector,
    "whois_native": WhoisNativeConnector,
    "crt_sh": CrtShConnector,
    "haveibeenpwned": HaveIBeenPwnedConnector,
    "web_scraper": WebScraperConnector,
    "wayback": WaybackConnector,
    "ip_api": IpApiConnector,
    "emailrep": EmailRepConnector,
    "virustotal": VirusTotalConnector,
    "hunter": HunterConnector,
    "securitytrails": SecurityTrailsConnector,
    "shodan_internetdb": ShodanInternetDBConnector,
    "otx": OTXConnector,
    "abuseipdb": AbuseIPDBConnector,
    "urlscan": URLScanConnector,
}


class ConnectorRegistry:
    def __init__(self, state, telemetry):
        self.state = state
        self.telemetry = telemetry
        self.connectors = {}
        self.health = {}
        self.config = json.loads(CONFIG_PATH.read_text())
        self._init()

    def _init(self):
        for key, cfg in self.config["connectors"].items():
            if not cfg.get("enabled", True):
                continue
            cls = CONNECTOR_MAP.get(key, BinaryConnector)
            self.connectors[key] = cls(cfg, self.state, self.telemetry)

    def get(self, name):
        return self.connectors.get(name)

    def list(self):
        return [
            {
                "key": key,
                "name": conn.name,
                "type": conn.config.get("type"),
                "accepts": conn.config.get("accepts", []),
                "outputs": conn.config.get("outputs", []),
                "native": bool(conn.config.get("native")),
                "healthy": self.health.get(key, {}).get("ok"),
            }
            for key, conn in self.connectors.items()
        ]

    def for_input_type(self, input_type):
        matching = []
        for key, conn in self.connectors.items():
            if input_type in conn.config.get("accepts", []):
                matching.append({"key": key, "connector": conn, "priority": conn.config.get("priority", 5)})
        return sorted(matching, key=lambda x: x["priority"])

    def for_phase(self, phase_config):
        result = []
        for name in phase_config.get("connectors", []):
            conn = self.connectors.get(name)
            if conn:
                result.append({"key": name, "connector": conn})
        return result

    async def check_health(self):
        import asyncio
        results = []
        for key, conn in self.connectors.items():
            try:
                result = await conn.health_check()
                has_key = conn.check_api_key()
                self.health[key] = {**result, "hasApiKey": has_key}
                results.append({"key": key, **result, "hasApiKey": has_key})
            except Exception:
                self.health[key] = {"ok": False}
                results.append({"key": key, "ok": False})
        return results

    def get_health_summary(self):
        total = len(self.connectors)
        healthy = sum(1 for s in self.health.values() if s.get("ok"))
        return {"total": total, "healthy": healthy, "unhealthy": total - healthy}
