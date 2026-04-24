import { spawn } from 'child_process';
import { existsSync } from 'fs';

export class BaseConnector {
    constructor(config, state, telemetry) {
        this.config = config;
        this.state = state;
        this.telemetry = telemetry;
        this.name = config.name;
        this.binary = config.binary;
        this.parseMode = config.parse_mode;
    }

    async healthCheck() {
        if (!this.config.health_check) return { ok: false, reason: 'no health check defined' };
        try {
            const [cmd, ...args] = this.config.health_check.split(' ');
            const result = await this._exec(cmd, args, 10000);
            return { ok: result.exitCode === 0, version: result.stdout.trim().split('\n')[0] };
        } catch (e) {
            return { ok: false, reason: e.message };
        }
    }

    async checkApiKey() {
        if (!this.config.api_key_env) return true;
        return !!process.env[this.config.api_key_env];
    }

    buildArgs(inputType, inputValue) {
        let template = this.config.args_template;
        const replacements = {
            '{username}': inputValue,
            '{email}': inputValue,
            '{domain}': inputValue,
            '{phone}': inputValue,
            '{target}': inputValue,
            '{url}': inputValue,
            '{ip}': inputValue
        };
        for (const [key, val] of Object.entries(replacements)) {
            template = template.replaceAll(key, val);
        }
        return template.split(' ').filter(Boolean);
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const args = this.buildArgs(inputType, inputValue);
            const result = await this._exec(this.binary, args, this.config.timeout);

            const entities = this.parse(result.stdout, result.stderr, inputType, inputValue);

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence || 0.5);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);

                if (entity.asKnown) {
                    this.state.addKnown(investigationId, entity.asKnown.type, entity.asKnown.value, this.name, entity.confidence || 0.5);
                }
            }

            this.state.completeConnectorRun(runId, 'completed', newCount, result.stdout?.slice(0, 10000), null, result.exitCode);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'completed', entitiesFound: newCount, input: { type: inputType, value: inputValue }
            });

            return { status: 'completed', entities, newCount };
        } catch (e) {
            const status = e.message.includes('timeout') ? 'timeout' : 'failed';
            this.state.completeConnectorRun(runId, status, 0, null, e.message, e.exitCode);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status, entitiesFound: 0, input: { type: inputType, value: inputValue }
            });
            this.telemetry.error(investigationId, this.name, e.message, phaseId);
            return { status, error: e.message };
        }
    }

    parse(stdout, stderr, inputType, inputValue) {
        return [];
    }

    _exec(cmd, args, timeout = 120000) {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let killed = false;

            const proc = spawn(cmd, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout,
                env: { ...process.env, NO_COLOR: '1' }
            });

            proc.stdout.on('data', d => { stdout += d; });
            proc.stderr.on('data', d => { stderr += d; });

            const timer = setTimeout(() => {
                killed = true;
                proc.kill('SIGKILL');
            }, timeout);

            proc.on('close', code => {
                clearTimeout(timer);
                if (killed) {
                    reject(Object.assign(new Error(`timeout after ${timeout}ms`), { exitCode: code }));
                } else {
                    resolve({ stdout, stderr, exitCode: code });
                }
            });

            proc.on('error', err => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }
}
