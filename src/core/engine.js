import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { State } from './state.js';
import { Telemetry } from './telemetry.js';
import { ConnectorRegistry } from '../connectors/registry.js';
import { Correlator } from '../correlate/linker.js';
import { ReportGenerator } from '../reporting/generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_PATH = join(__dirname, '..', '..', 'config', 'workflows.json');

export class Engine {
    constructor(dbPath) {
        this.state = new State(dbPath);
        this.telemetry = new Telemetry(this.state);
        this.registry = new ConnectorRegistry(this.state, this.telemetry);
        this.correlator = new Correlator(this.state);
        this.reporter = new ReportGenerator(this.state);
        this.workflows = JSON.parse(readFileSync(WORKFLOWS_PATH, 'utf-8'));
        this.running = new Map();
        this.aborted = new Set();
    }

    async investigate(name, knowns, workflow = 'person_full', config = {}) {
        const wf = this.workflows.workflows[workflow];
        if (!wf) throw new Error(`unknown workflow: ${workflow}`);

        const investigationId = this.state.createInvestigation(name, workflow, config);

        for (const known of knowns) {
            this.state.addKnown(investigationId, known.type, known.value);
        }

        this.state.updateInvestigationStatus(investigationId, 'running');
        this.running.set(investigationId, { workflow: wf, started: Date.now() });

        try {
            await this._executeWorkflow(investigationId, wf);
            this.state.updateInvestigationStatus(investigationId, 'completed');
        } catch (e) {
            this.state.updateInvestigationStatus(investigationId, 'failed');
            this.telemetry.error(investigationId, null, e.message);
            throw e;
        } finally {
            this.running.delete(investigationId);
        }

        return investigationId;
    }

    async _executeWorkflow(investigationId, workflow) {
        const completed = new Set();
        const phases = workflow.phases;

        while (completed.size < phases.length) {
            if (this.aborted.has(investigationId)) {
                throw new Error('investigation aborted');
            }

            const ready = phases.filter(p =>
                !completed.has(p.id) &&
                p.depends_on.every(dep => completed.has(dep))
            );

            if (ready.length === 0 && completed.size < phases.length) {
                throw new Error('workflow deadlock — unresolvable dependencies');
            }

            const parallel = ready.filter(p => {
                const connectors = this.registry.forPhase(p);
                return connectors.some(c => c.connector.config.parallel);
            });
            const sequential = ready.filter(p => !parallel.includes(p));

            if (parallel.length > 0) {
                await Promise.all(parallel.map(p => this._executePhase(investigationId, p)));
                for (const p of parallel) completed.add(p.id);
            }

            for (const phase of sequential) {
                await this._executePhase(investigationId, phase);
                completed.add(phase.id);
            }
        }
    }

    async _executePhase(investigationId, phase) {
        this.state.recordPhaseRun(investigationId, phase.id);
        this.telemetry.phaseStart(investigationId, phase.id);

        try {
            if (phase.internal) {
                await this._executeInternalPhase(investigationId, phase);
            } else {
                await this._executeConnectorPhase(investigationId, phase);
            }
            this.state.completePhaseRun(investigationId, phase.id, 'completed');
            this.telemetry.phaseEnd(investigationId, phase.id, 'completed');
        } catch (e) {
            this.state.completePhaseRun(investigationId, phase.id, 'failed');
            this.telemetry.phaseEnd(investigationId, phase.id, 'failed');
        }
    }

    async _executeConnectorPhase(investigationId, phase) {
        const connectors = this.registry.forPhase(phase);
        const knowns = this.state.getKnowns(investigationId);
        const tasks = [];

        if (!this._healthCache) this._healthCache = new Map();

        for (const { key, connector } of connectors) {
            if (!connector.config.native && connector.config.binary) {
                if (!this._healthCache.has(key)) {
                    const h = await connector.healthCheck();
                    this._healthCache.set(key, h.ok);
                }
                if (!this._healthCache.get(key)) continue;
            }

            const acceptedKnowns = knowns.filter(k => connector.config.accepts.includes(k.type));

            if (acceptedKnowns.length === 0 && phase.input_types) {
                const entities = this.state.getEntities(investigationId);
                const seen = new Set(acceptedKnowns.map(k => `${k.type}:${k.value}`));
                for (const entity of entities) {
                    for (const inputType of phase.input_types) {
                        const value = this._entityToInput(entity, inputType);
                        if (value && connector.config.accepts.includes(inputType)) {
                            const key2 = `${inputType}:${value}`;
                            if (!seen.has(key2)) {
                                seen.add(key2);
                                acceptedKnowns.push({ type: inputType, value });
                            }
                        }
                    }
                }
            }

            const maxInputsPerConnector = connector.config.native ? 20 : 5;
            const limited = acceptedKnowns.slice(0, maxInputsPerConnector);
            for (const known of limited) {
                tasks.push({ connector, key, inputType: known.type, inputValue: known.value });
            }
        }

        const maxParallel = 8;
        for (let i = 0; i < tasks.length; i += maxParallel) {
            const batch = tasks.slice(i, i + maxParallel);
            await Promise.allSettled(
                batch.map(t => t.connector.run(investigationId, phase.id, t.inputType, t.inputValue))
            );
        }
    }

    async _executeInternalPhase(investigationId, phase) {
        if (phase.id === 'correlation') {
            this.correlator.correlate(investigationId);
        } else if (phase.id === 'reporting') {
            await this.reporter.generate(investigationId);
        }
    }

    _entityToInput(entity, inputType) {
        const mapping = {
            email: () => entity.data.address,
            domain: () => entity.data.name,
            subdomain: () => entity.data.name,
            ip: () => entity.data.address,
            url: () => entity.data.url,
            username: () => entity.data.username,
            phone: () => entity.data.number
        };
        const fn = mapping[inputType];
        return fn ? fn() : null;
    }

    abort(investigationId) {
        this.aborted.add(investigationId);
    }

    getStatus(investigationId) {
        const investigation = this.state.getInvestigation(investigationId);
        const stats = this.state.getStats(investigationId);
        const active = this.telemetry.getActiveRuns().filter(r => r.investigationId === investigationId);
        return { investigation, stats, active };
    }

    close() {
        this.state.close();
    }
}
