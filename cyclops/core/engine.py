import asyncio
import json
from pathlib import Path

from cyclops.core.state import State
from cyclops.core.telemetry import Telemetry
from cyclops.connectors.registry import ConnectorRegistry
from cyclops.correlate.linker import Correlator
from cyclops.reporting.generator import Reporter

CONFIG_DIR = Path(__file__).parent.parent.parent / "config"


class Engine:
    def __init__(self, db_path=":memory:"):
        self.state = State(db_path)
        self.telemetry = Telemetry()
        self.registry = ConnectorRegistry(self.state, self.telemetry)
        self.correlator = Correlator(self.state, self.telemetry)
        self.reporter = Reporter(self.state)
        self.workflows = json.loads((CONFIG_DIR / "workflows.json").read_text())["workflows"]

    async def investigate(self, name, knowns, workflow=None):
        if not workflow:
            workflow = self._pick_workflow(knowns)
        wf = self.workflows.get(workflow)
        if not wf:
            raise ValueError(f"Unknown workflow: {workflow}")

        inv_id = self.state.create_investigation(name, workflow)
        for k in knowns:
            self.state.add_known(inv_id, k["type"], k["value"])

        self.state.update_investigation_status(inv_id, "running")

        phases = wf["phases"]
        completed_phases = set()

        while True:
            runnable = [
                p for p in phases
                if p["id"] not in completed_phases
                and all(d in completed_phases for d in p.get("depends_on", []))
            ]
            if not runnable:
                break

            for phase in runnable:
                await self._run_phase(inv_id, phase)
                completed_phases.add(phase["id"])

        self.state.update_investigation_status(inv_id, "completed")
        return inv_id

    async def _run_phase(self, inv_id, phase):
        phase_id = phase["id"]
        self.telemetry.phase_start(inv_id, phase_id)

        if phase.get("internal"):
            if phase_id == "correlation":
                self.correlator.correlate(inv_id)
            elif phase_id == "reporting":
                pass
            self.telemetry.phase_end(inv_id, phase_id, "completed")
            return

        connectors = self.registry.for_phase(phase)
        if not connectors:
            self.telemetry.phase_end(inv_id, phase_id, "completed")
            return

        input_types = phase.get("input_types", [])
        inputs = []
        for t in input_types:
            for k in self.state.get_knowns(inv_id, t):
                inputs.append((t, k["value"]))

        if not inputs:
            self.telemetry.phase_end(inv_id, phase_id, "completed")
            return

        tasks = []
        for entry in connectors:
            conn = entry["connector"]
            for input_type, input_value in inputs:
                if input_type in conn.config.get("accepts", []):
                    tasks.append(self._run_connector(conn, inv_id, phase_id, input_type, input_value))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        self.telemetry.phase_end(inv_id, phase_id, "completed")

    async def _run_connector(self, connector, inv_id, phase_id, input_type, input_value):
        try:
            return await connector.run(inv_id, phase_id, input_type, input_value)
        except Exception as e:
            return {"status": "failed", "error": str(e)}

    def _pick_workflow(self, knowns):
        types = {k["type"] for k in knowns}
        if types & {"domain", "ip"}:
            return "domain_recon"
        if types & {"email", "phone"}:
            return "person_full"
        return "username_trace"

    def close(self):
        self.state.close()
