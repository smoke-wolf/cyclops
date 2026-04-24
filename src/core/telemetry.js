export class Telemetry {
    constructor(state) {
        this.state = state;
        this.live = new Map();
        this.listeners = [];
    }

    onEvent(callback) {
        this.listeners.push(callback);
    }

    _broadcast(event) {
        for (const cb of this.listeners) {
            try { cb(event); } catch {}
        }
    }

    connectorStart(investigationId, connector, phaseId, input) {
        const event = {
            type: 'connector_start',
            investigationId,
            connector,
            phaseId,
            input,
            timestamp: Date.now()
        };
        this.live.set(`${investigationId}:${connector}:${input?.value}`, event);
        this.state.logTelemetry(investigationId, 'connector_start', event, connector, phaseId);
        this._broadcast(event);
    }

    connectorEnd(investigationId, connector, phaseId, result) {
        const key = `${investigationId}:${connector}:${result?.input?.value}`;
        const start = this.live.get(key);
        const duration = start ? Date.now() - start.timestamp : 0;

        const event = {
            type: 'connector_end',
            investigationId,
            connector,
            phaseId,
            status: result.status,
            entitiesFound: result.entitiesFound || 0,
            input: result.input,
            duration,
            timestamp: Date.now()
        };
        this.live.delete(key);
        this.state.logTelemetry(investigationId, 'connector_end', event, connector, phaseId);
        this._broadcast(event);
    }

    phaseStart(investigationId, phaseId) {
        const event = { type: 'phase_start', investigationId, phaseId, timestamp: Date.now() };
        this.state.logTelemetry(investigationId, 'phase_start', event, null, phaseId);
        this._broadcast(event);
    }

    phaseEnd(investigationId, phaseId, status) {
        const event = { type: 'phase_end', investigationId, phaseId, status, timestamp: Date.now() };
        this.state.logTelemetry(investigationId, 'phase_end', event, null, phaseId);
        this._broadcast(event);
    }

    entityDiscovered(investigationId, entityType, isNew, connector) {
        const event = {
            type: isNew ? 'entity_new' : 'entity_updated',
            investigationId,
            entityType,
            connector,
            timestamp: Date.now()
        };
        this.state.logTelemetry(investigationId, event.type, event, connector);
        this._broadcast(event);
    }

    error(investigationId, connector, message, phaseId = null) {
        const event = {
            type: 'error',
            investigationId,
            connector,
            message,
            phaseId,
            timestamp: Date.now()
        };
        this.state.logTelemetry(investigationId, 'error', event, connector, phaseId);
        this._broadcast(event);
    }

    getActiveRuns() {
        return Array.from(this.live.values());
    }

    getSummary(investigationId) {
        return this.state.getStats(investigationId);
    }
}
