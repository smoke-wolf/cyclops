import { BaseConnector } from './base.js';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

export class PhotonConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];
        const outputDir = `/tmp/cyclops_photon_${inputValue}`;

        const parseFile = (filePath, parser) => {
            if (!existsSync(filePath)) return;
            const content = readFileSync(filePath, 'utf-8');
            parser(content);
        };

        parseFile(join(outputDir, 'email.txt'), content => {
            for (const email of content.split('\n').filter(Boolean)) {
                entities.push({
                    type: 'email',
                    data: { address: email.trim(), source: 'photon_crawl', domain: inputValue },
                    confidence: 0.8,
                    asKnown: { type: 'email', value: email.trim() }
                });
            }
        });

        parseFile(join(outputDir, 'external.txt'), content => {
            for (const url of content.split('\n').filter(Boolean)) {
                entities.push({
                    type: 'url',
                    data: { url: url.trim(), source: 'photon_crawl' },
                    confidence: 0.6
                });

                const socialPatterns = [
                    { pattern: /twitter\.com\/(\w+)/i, platform: 'Twitter' },
                    { pattern: /x\.com\/(\w+)/i, platform: 'Twitter' },
                    { pattern: /github\.com\/(\w+)/i, platform: 'GitHub' },
                    { pattern: /linkedin\.com\/in\/([\w-]+)/i, platform: 'LinkedIn' },
                    { pattern: /facebook\.com\/([\w.]+)/i, platform: 'Facebook' },
                    { pattern: /instagram\.com\/(\w+)/i, platform: 'Instagram' },
                    { pattern: /reddit\.com\/user\/(\w+)/i, platform: 'Reddit' },
                    { pattern: /youtube\.com\/(user|channel|@)([\w-]+)/i, platform: 'YouTube' }
                ];

                for (const { pattern, platform } of socialPatterns) {
                    const match = url.match(pattern);
                    if (match) {
                        const username = match[2] || match[1];
                        entities.push({
                            type: 'account',
                            data: { platform, username, url: url.trim(), verified: false },
                            confidence: 0.6,
                            asKnown: { type: 'username', value: username }
                        });
                    }
                }
            }
        });

        parseFile(join(outputDir, 'intel.txt'), content => {
            for (const line of content.split('\n').filter(Boolean)) {
                const ipMatch = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
                if (ipMatch) {
                    entities.push({
                        type: 'ip',
                        data: { address: ipMatch[0], source: 'photon_crawl' },
                        confidence: 0.6,
                        asKnown: { type: 'ip', value: ipMatch[0] }
                    });
                }
            }
        });

        parseFile(join(outputDir, 'fuzzable.txt'), content => {
            for (const url of content.split('\n').filter(Boolean)) {
                entities.push({
                    type: 'url',
                    data: { url: url.trim(), fuzzable: true, source: 'photon_crawl' },
                    confidence: 0.5
                });
            }
        });

        return entities;
    }
}
