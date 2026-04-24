import { BaseConnector } from './base.js';

export class ShodanConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];

        try {
            const data = JSON.parse(stdout);
            if (data.ip_str) {
                entities.push({
                    type: 'ip',
                    data: {
                        address: data.ip_str,
                        asn: data.asn,
                        org: data.org,
                        country: data.country_code,
                        city: data.city,
                        isp: data.isp,
                        os: data.os
                    },
                    confidence: 0.95
                });
            }

            for (const service of (data.data || [])) {
                entities.push({
                    type: 'port',
                    data: {
                        number: service.port,
                        protocol: service.transport || 'tcp',
                        service: service.product || service._shodan?.module,
                        version: service.version,
                        banner: service.data?.slice(0, 500),
                        address: data.ip_str
                    },
                    confidence: 0.95
                });
            }

            for (const vuln of (data.vulns || [])) {
                entities.push({
                    type: 'vulnerability',
                    data: { cve: vuln, target: data.ip_str, source: 'shodan' },
                    confidence: 0.7
                });
            }

            for (const hostname of (data.hostnames || [])) {
                entities.push({
                    type: 'domain',
                    data: { name: hostname },
                    confidence: 0.8,
                    asKnown: { type: 'domain', value: hostname }
                });
            }
        } catch {
            const lines = stdout.split('\n');
            for (const line of lines) {
                const portMatch = line.match(/(\d+)\/(\w+)\s+(.*)/);
                if (portMatch) {
                    entities.push({
                        type: 'port',
                        data: {
                            number: parseInt(portMatch[1]),
                            protocol: portMatch[2],
                            service: portMatch[3],
                            address: inputValue
                        },
                        confidence: 0.8
                    });
                }
            }
        }
        return entities;
    }
}
