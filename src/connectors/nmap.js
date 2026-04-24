import { BaseConnector } from './base.js';

export class NmapConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];
        const portRegex = /(\d+)\/(\w+)\s+(\w+)\s+(\S+)\s*(.*)/g;
        const osRegex = /OS details:\s*(.+)/;
        const macRegex = /MAC Address:\s*([0-9A-F:]+)\s*\(([^)]+)\)/i;

        for (const match of stdout.matchAll(portRegex)) {
            if (match[3] === 'open') {
                entities.push({
                    type: 'port',
                    data: {
                        number: parseInt(match[1]),
                        protocol: match[2],
                        service: match[4],
                        version: match[5]?.trim() || null,
                        address: inputValue
                    },
                    confidence: 0.95
                });
            }
        }

        const osMatch = stdout.match(osRegex);
        if (osMatch) {
            entities.push({
                type: 'ip',
                data: { address: inputValue, os_fingerprint: osMatch[1] },
                confidence: 0.8
            });
        }

        const macMatch = stdout.match(macRegex);
        if (macMatch) {
            entities.push({
                type: 'ip',
                data: { address: inputValue, mac: macMatch[1], mac_vendor: macMatch[2] },
                confidence: 0.95
            });
        }

        const scriptRegex = /\|\s+(\S+):\s*\n([\s\S]*?)(?=\n\|_|\n[^|])/g;
        for (const match of stdout.matchAll(scriptRegex)) {
            const scriptName = match[1];
            const scriptOutput = match[2].trim();
            if (scriptName.includes('vuln') || scriptName.includes('CVE')) {
                const cves = scriptOutput.match(/CVE-\d{4}-\d+/g);
                for (const cve of (cves || [])) {
                    entities.push({
                        type: 'vulnerability',
                        data: { cve, target: inputValue, source: `nmap:${scriptName}` },
                        confidence: 0.7
                    });
                }
            }
        }

        return entities;
    }
}
