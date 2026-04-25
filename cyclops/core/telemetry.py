from datetime import datetime, timezone


class Telemetry:
    def __init__(self):
        self._listeners = []
        self._active_runs = {}

    def on_event(self, callback):
        self._listeners.append(callback)

    def _emit(self, event):
        event["timestamp"] = datetime.now(timezone.utc).isoformat()
        for cb in self._listeners:
            try:
                cb(event)
            except Exception:
                pass

    def phase_start(self, inv_id, phase_id):
        self._emit({"type": "phase_start", "investigationId": inv_id, "phaseId": phase_id})

    def phase_end(self, inv_id, phase_id, status):
        self._emit({"type": "phase_end", "investigationId": inv_id, "phaseId": phase_id, "status": status})

    def connector_start(self, inv_id, connector, phase_id, meta=None):
        key = f"{inv_id}:{connector}:{meta.get('value', '') if meta else ''}"
        self._active_runs[key] = {"connector": connector, "phase_id": phase_id, "meta": meta}
        self._emit({"type": "connector_start", "investigationId": inv_id, "connector": connector, "phaseId": phase_id, **(meta or {})})

    def connector_end(self, inv_id, connector, phase_id, meta=None):
        key = f"{inv_id}:{connector}:{meta.get('input', {}).get('value', '') if meta else ''}"
        self._active_runs.pop(key, None)
        self._emit({"type": "connector_end", "investigationId": inv_id, "connector": connector, "phaseId": phase_id, **(meta or {})})

    def entity_discovered(self, inv_id, entity_type, is_new, source):
        event_type = "entity_new" if is_new else "entity_dup"
        self._emit({"type": event_type, "investigationId": inv_id, "entityType": entity_type, "source": source})

    def get_active_runs(self):
        return list(self._active_runs.values())
