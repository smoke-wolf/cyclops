import asyncio
import socket
from cyclops.connectors.base import BaseConnector


class DnsNativeConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "DNS-Native"

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            entities = []
            loop = asyncio.get_event_loop()

            record_types = ["A", "AAAA", "MX", "NS", "TXT", "SOA", "CNAME"]
            for rtype in record_types:
                try:
                    answers = await loop.run_in_executor(None, lambda rt=rtype: self._resolve(input_value, rt))
                    for answer in answers:
                        entities.append({
                            "type": "dns_record",
                            "data": {"type": rtype, "name": input_value, "value": answer, "source": "dns_native"},
                            "confidence": 0.95,
                        })
                        if rtype in ("A", "AAAA"):
                            entities.append({
                                "type": "ip",
                                "data": {"address": answer, "source": "dns_native"},
                                "confidence": 0.95,
                                "as_known": {"type": "ip", "value": answer},
                            })
                        elif rtype == "MX":
                            mx_host = answer.split()[-1].rstrip(".")
                            if mx_host:
                                entities.append({
                                    "type": "subdomain",
                                    "data": {"name": mx_host, "parent_domain": input_value, "source": "dns_mx"},
                                    "confidence": 0.9,
                                })
                        elif rtype == "NS":
                            ns_host = answer.rstrip(".")
                            entities.append({
                                "type": "subdomain",
                                "data": {"name": ns_host, "source": "dns_ns"},
                                "confidence": 0.9,
                            })
                        elif rtype == "TXT":
                            if "v=spf1" in answer:
                                for part in answer.split():
                                    if part.startswith("include:"):
                                        entities.append({
                                            "type": "domain",
                                            "data": {"name": part[8:], "source": "dns_spf"},
                                            "confidence": 0.7,
                                        })
                        elif rtype == "SOA":
                            parts = answer.split()
                            if len(parts) >= 2:
                                hostmaster = parts[1].rstrip(".")
                                hp = hostmaster.split(".")
                                if len(hp) >= 2:
                                    email = hp[0] + "@" + ".".join(hp[1:])
                                    entities.append({
                                        "type": "email",
                                        "data": {"address": email, "source": "soa_hostmaster"},
                                        "confidence": 0.5,
                                    })
                except Exception:
                    continue

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

    def _resolve(self, domain, record_type):
        import subprocess
        try:
            result = subprocess.run(
                ["dig", "+short", domain, record_type],
                capture_output=True, text=True, timeout=10,
            )
            return [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
        except Exception:
            if record_type == "A":
                try:
                    return [r[4][0] for r in socket.getaddrinfo(domain, None, socket.AF_INET)]
                except Exception:
                    return []
            return []

    async def health_check(self):
        return {"ok": True, "version": "native"}
