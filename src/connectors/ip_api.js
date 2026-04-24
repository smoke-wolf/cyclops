import { BaseConnector } from './base.js';
import http from 'http';

export class IpApiConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'IP-API';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];
            const raw = await this._fetch(`http://ip-api.com/json/${encodeURIComponent(inputValue)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,reverse,mobile,proxy,hosting,query`);
            let data;
            try { data = JSON.parse(raw); } catch { throw new Error('ip-api returned invalid JSON'); }

            if (data.status === 'success') {
                entities.push({
                    type: 'ip',
                    data: {
                        address: data.query,
                        country: data.countryCode,
                        country_name: data.country,
                        region: data.regionName,
                        city: data.city,
                        zip: data.zip,
                        lat: data.lat,
                        lon: data.lon,
                        timezone: data.timezone,
                        isp: data.isp,
                        org: data.org,
                        asn: data.as,
                        as_name: data.asname,
                        reverse_dns: data.reverse,
                        is_mobile: data.mobile,
                        is_proxy: data.proxy,
                        is_hosting: data.hosting,
                        source: 'ip-api'
                    },
                    confidence: 0.9
                });

                if (data.org && data.org !== data.isp) {
                    entities.push({
                        type: 'organization',
                        data: { name: data.org, source: 'ip_geolocation', asn: data.as },
                        confidence: 0.6
                    });
                }

                if (data.reverse) {
                    entities.push({
                        type: 'domain',
                        data: { name: data.reverse, source: 'reverse_dns' },
                        confidence: 0.7,
                        asKnown: { type: 'domain', value: data.reverse }
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
            const req = http.get(url, { headers: { 'User-Agent': 'cyclops-osint' }, timeout: 10000 }, res => {
                if (res.statusCode === 429) { reject(new Error('ip-api rate limited')); res.resume(); return; }
                if (res.statusCode >= 400) { reject(new Error(`ip-api HTTP ${res.statusCode}`)); res.resume(); return; }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('ip-api timeout')); });
        });
    }

    async healthCheck() { return { ok: true, version: 'native' }; }
}
