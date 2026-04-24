import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BaseConnector } from './base.js';
import { SherlockConnector } from './sherlock.js';
import { HoleheConnector } from './holehe.js';
import { MaigretConnector } from './maigret.js';
import { TheHarvesterConnector } from './theharvester.js';
import { AmassConnector } from './amass.js';
import { SubfinderConnector } from './subfinder.js';
import { ShodanConnector } from './shodan.js';
import { H8mailConnector } from './h8mail.js';
import { PhoneInfogaConnector } from './phoneinfoga.js';
import { NmapConnector } from './nmap.js';
import { DnsreconConnector } from './dnsrecon.js';
import { PhotonConnector } from './photon.js';
import { GitHubConnector } from './github.js';
import { DnsNativeConnector } from './dns_native.js';
import { WhoisNativeConnector } from './whois_native.js';
import { CrtShConnector } from './crt_sh.js';
import { HaveIBeenPwnedConnector } from './haveibeenpwned.js';
import { WebScraperConnector } from './web_scraper.js';
import { WaybackConnector } from './wayback.js';
import { IpApiConnector } from './ip_api.js';
import { EmailRepConnector } from './emailrep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config', 'connectors.json');

const CONNECTOR_MAP = {
    sherlock: SherlockConnector,
    holehe: HoleheConnector,
    maigret: MaigretConnector,
    theharvester: TheHarvesterConnector,
    amass: AmassConnector,
    subfinder: SubfinderConnector,
    shodan: ShodanConnector,
    h8mail: H8mailConnector,
    phoneinfoga: PhoneInfogaConnector,
    nmap: NmapConnector,
    dnsrecon: DnsreconConnector,
    photon: PhotonConnector,
    github: GitHubConnector,
    dns_native: DnsNativeConnector,
    whois_native: WhoisNativeConnector,
    crt_sh: CrtShConnector,
    haveibeenpwned: HaveIBeenPwnedConnector,
    web_scraper: WebScraperConnector,
    wayback: WaybackConnector,
    ip_api: IpApiConnector,
    emailrep: EmailRepConnector
};

export class ConnectorRegistry {
    constructor(state, telemetry) {
        this.state = state;
        this.telemetry = telemetry;
        this.connectors = new Map();
        this.health = new Map();
        this.config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
        this._init();
    }

    _init() {
        for (const [key, cfg] of Object.entries(this.config.connectors)) {
            if (!cfg.enabled) continue;
            const ConnectorClass = CONNECTOR_MAP[key] || BaseConnector;
            this.connectors.set(key, new ConnectorClass(cfg, this.state, this.telemetry));
        }
    }

    get(name) {
        return this.connectors.get(name);
    }

    list() {
        return Array.from(this.connectors.entries()).map(([key, conn]) => ({
            key,
            name: conn.name,
            type: conn.config.type,
            accepts: conn.config.accepts,
            outputs: conn.config.outputs,
            healthy: this.health.get(key)?.ok ?? null
        }));
    }

    forInputType(inputType) {
        const matching = [];
        for (const [key, conn] of this.connectors) {
            if (conn.config.accepts.includes(inputType)) {
                matching.push({ key, connector: conn, priority: conn.config.priority });
            }
        }
        return matching.sort((a, b) => a.priority - b.priority);
    }

    forPhase(phaseConfig) {
        return phaseConfig.connectors
            .map(name => ({ key: name, connector: this.connectors.get(name) }))
            .filter(c => c.connector);
    }

    async checkHealth() {
        const results = await Promise.allSettled(
            Array.from(this.connectors.entries()).map(async ([key, conn]) => {
                const result = await conn.healthCheck();
                const hasKey = await conn.checkApiKey();
                this.health.set(key, { ...result, hasApiKey: hasKey });
                return { key, ...result, hasApiKey: hasKey };
            })
        );
        return results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, reason: 'check failed' });
    }

    getHealthSummary() {
        const summary = { total: this.connectors.size, healthy: 0, unhealthy: 0, unchecked: 0 };
        for (const [key, status] of this.health) {
            if (status.ok) summary.healthy++;
            else summary.unhealthy++;
        }
        summary.unchecked = summary.total - summary.healthy - summary.unhealthy;
        return summary;
    }
}
