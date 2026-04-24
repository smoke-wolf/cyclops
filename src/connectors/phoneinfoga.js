import { BaseConnector } from './base.js';

export class PhoneInfogaConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];

        try {
            const data = JSON.parse(stdout);
            entities.push({
                type: 'phone',
                data: {
                    number: inputValue,
                    carrier: data.carrier || null,
                    line_type: data.line_type || null,
                    country: data.country || data.countryCode || null,
                    location: data.location || null,
                    valid: data.valid ?? true
                },
                confidence: 0.9
            });

            for (const scan of (data.scanners || [])) {
                if (scan.results) {
                    for (const result of scan.results) {
                        if (result.url) {
                            entities.push({
                                type: 'url',
                                data: { url: result.url, title: result.title || scan.name },
                                confidence: 0.6
                            });
                        }
                    }
                }
            }
        } catch {
            const lines = stdout.split('\n');
            const phoneData = { number: inputValue };
            for (const line of lines) {
                const kv = line.match(/(\w[\w\s]+):\s+(.+)/);
                if (kv) {
                    const key = kv[1].trim().toLowerCase().replace(/\s+/g, '_');
                    phoneData[key] = kv[2].trim();
                }
            }
            if (Object.keys(phoneData).length > 1) {
                entities.push({ type: 'phone', data: phoneData, confidence: 0.7 });
            }
        }
        return entities;
    }
}
