import asyncio
import socket
from cyclops.connectors.base import BaseConnector


class WhoisNativeConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "WHOIS-Native"

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            loop = asyncio.get_event_loop()
            raw = await loop.run_in_executor(None, self._whois_query, input_value)
            entities = self._parse_whois(raw, input_value)

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

    def _whois_query(self, domain):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)
        try:
            sock.connect(("whois.verisign-grs.com", 43))
            sock.send(f"={domain}\r\n".encode())
            data = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
            first_pass = data.decode("utf-8", errors="replace")
            refer = None
            for line in first_pass.split("\n"):
                if line.strip().lower().startswith("whois server:"):
                    refer = line.split(":", 1)[1].strip()
                    break
            if refer:
                sock2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock2.settimeout(10)
                try:
                    sock2.connect((refer, 43))
                    sock2.send(f"{domain}\r\n".encode())
                    data2 = b""
                    while True:
                        chunk = sock2.recv(4096)
                        if not chunk:
                            break
                        data2 += chunk
                    return data2.decode("utf-8", errors="replace")
                finally:
                    sock2.close()
            return first_pass
        finally:
            sock.close()

    def _parse_whois(self, raw, domain):
        entities = []
        info = {}
        for line in raw.split("\n"):
            if ":" not in line or line.strip().startswith("%") or line.strip().startswith("#"):
                continue
            key, _, value = line.partition(":")
            key = key.strip().lower()
            value = value.strip()
            if not value:
                continue
            if "registrar" in key and "registrar" not in info:
                info["registrar"] = value
            elif "creation" in key or "created" in key:
                info["created_at"] = value
            elif "expir" in key:
                info["expires_at"] = value
            elif "name server" in key or "nserver" in key:
                info.setdefault("nameservers", []).append(value.lower().rstrip("."))
            elif "registrant" in key and "name" in key:
                info["registrant_name"] = value
            elif "registrant" in key and "org" in key:
                info["registrant_org"] = value

        if info:
            entities.append({"type": "domain", "data": {"name": domain, "source": "whois", **info}, "confidence": 0.9})
        if info.get("registrant_org"):
            entities.append({"type": "organization", "data": {"name": info["registrant_org"], "source": "whois"}, "confidence": 0.7})
        for ns in info.get("nameservers", []):
            entities.append({"type": "subdomain", "data": {"name": ns, "source": "whois_ns"}, "confidence": 0.9})

        return entities

    async def health_check(self):
        return {"ok": True, "version": "native"}
