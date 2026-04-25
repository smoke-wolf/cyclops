import asyncio
import os
import shutil
import json


class BaseConnector:
    def __init__(self, config, state, telemetry):
        self.config = config
        self.state = state
        self.telemetry = telemetry
        self.name = config.get("name", self.__class__.__name__)

    async def run(self, investigation_id, phase_id, input_type, input_value):
        raise NotImplementedError

    async def health_check(self):
        return {"ok": True}

    def check_api_key(self):
        env = self.config.get("api_key_env")
        return bool(os.environ.get(env)) if env else True


class BinaryConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.binary = config.get("binary")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        if not shutil.which(self.binary):
            return {"status": "skipped", "error": f"{self.binary} not installed"}

        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            args = self.build_args(input_type, input_value)
            proc = await asyncio.create_subprocess_exec(
                self.binary, *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            timeout = self.config.get("timeout", 120000) / 1000
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            raw = stdout.decode("utf-8", errors="replace")

            entities = self.parse(raw, input_type, input_value)
            new_count = 0
            for entity in entities:
                added = self.state.add_entity(investigation_id, entity["type"], entity["data"], entity.get("confidence", 0.5))
                if added["new"]:
                    new_count += 1
                self.telemetry.entity_discovered(investigation_id, entity["type"], added["new"], self.name)
                if "as_known" in entity:
                    self.state.add_known(investigation_id, entity["as_known"]["type"], entity["as_known"]["value"], self.name)

            self.state.complete_connector_run(run_id, "completed", new_count)
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {
                "status": "completed", "entitiesFound": new_count, "input": {"type": input_type, "value": input_value}
            })
            return {"status": "completed", "entities": entities, "newCount": new_count}
        except asyncio.TimeoutError:
            self.state.complete_connector_run(run_id, "failed", 0, error=f"{self.name} timeout")
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "failed", "input": {"type": input_type, "value": input_value}})
            return {"status": "failed", "error": f"{self.name} timeout"}
        except Exception as e:
            self.state.complete_connector_run(run_id, "failed", 0, error=str(e))
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "failed", "input": {"type": input_type, "value": input_value}})
            return {"status": "failed", "error": str(e)}

    def build_args(self, input_type, input_value):
        sanitized = "".join(c if c.isalnum() or c in "._-" else "_" for c in input_value)
        template = self.config.get("args_template", "{target}")
        for placeholder in ["{target}", "{username}", "{email}", "{domain}", "{url}", "{phone}", "{ip}"]:
            template = template.replace(placeholder, sanitized)
        return template.split()

    def parse(self, raw_output, input_type, input_value):
        return []

    async def health_check(self):
        return {"ok": bool(shutil.which(self.binary)), "binary": self.binary}
