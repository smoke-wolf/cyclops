import { BaseConnector } from './base.js';
import https from 'https';

export class CrtShConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'crt.sh';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const data = await this._fetch(`https://crt.sh/?q=%25.${encodeURIComponent(inputValue)}&output=json`);
            if (data.trimStart().startsWith('<')) throw new Error('crt.sh returned HTML (rate limited or down)');
            const records = JSON.parse(data);
            const entities = [];
            const seen = new Set();

            for (const cert of records) {
                const names = (cert.name_value || '').split('\n');
                for (const name of names) {
                    const clean = name.trim().replace(/^\*\./, '');
                    if (!clean || seen.has(clean)) continue;
                    seen.add(clean);

                    entities.push({
                        type: 'subdomain',
                        data: {
                            name: clean,
                            parent_domain: inputValue,
                            source: 'certificate_transparency'
                        },
                        confidence: 0.9,
                        asKnown: { type: 'domain', value: clean }
                    });
                }

                if (cert.issuer_name && !seen.has('cert:' + cert.serial_number)) {
                    seen.add('cert:' + cert.serial_number);
                    entities.push({
                        type: 'certificate',
                        data: {
                            subject: cert.common_name,
                            issuer: cert.issuer_name,
                            not_before: cert.not_before,
                            not_after: cert.not_after,
                            serial: cert.serial_number,
                            san: cert.name_value
                        },
                        confidence: 0.95
                    });
                }
            }

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence || 0.5);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);
                if (entity.asKnown) {
                    this.state.addKnown(investigationId, entity.asKnown.type, entity.asKnown.value, this.name, entity.confidence || 0.5);
                }
            }

            this.state.completeConnectorRun(runId, 'completed', newCount, null, null, 0);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'completed', entitiesFound: newCount, input: { type: inputType, value: inputValue }
            });
            return { status: 'completed', entities, newCount };
        } catch (e) {
            this.state.completeConnectorRun(runId, 'failed', 0, null, e.message, 1);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'failed', entitiesFound: 0, input: { type: inputType, value: inputValue }
            });
            return { status: 'failed', error: e.message };
        }
    }

    _fetch(url) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { headers: { 'User-Agent': 'cyclops-osint' }, timeout: 30000 }, res => {
                if (res.statusCode === 429) { reject(new Error('crt.sh returned HTML (rate limited or down)')); res.resume(); return; }
                if (res.statusCode >= 400) { reject(new Error(`crt.sh HTTP ${res.statusCode}`)); res.resume(); return; }
                let data = '';
                res.on('data', chunk => { data += chunk; if (data.length > 5e6) { req.destroy(); reject(new Error('response too large')); } });
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('crt.sh timeout')); });
        });
    }

    async healthCheck() { return { ok: true, version: 'native' }; }
}
