#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');

const FONT = "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace";
const BG = '#0d1117';
const FG = '#c9d1d9';
const C = {
    red: '#ff7b72', green: '#7ee787', yellow: '#e3b341', blue: '#79c0ff',
    magenta: '#d2a8ff', cyan: '#a5d6ff', dim: '#6e7681', white: '#ffffff',
    orange: '#ffa657',
};

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const FRAMES = [
    { delay: 0, lines: [
        { text: '$ ', color: C.dim },
    ]},
    { delay: 0.4, lines: [
        { text: '$ cyclops ', color: C.dim },
        { text: 'smoke-wolf', color: C.white, bold: true },
    ]},
    { delay: 1.2, lines: [
        { text: '$ cyclops smoke-wolf', color: C.dim },
        { text: '' },
        { text: '   ██████╗██╗   ██╗ ██████╗██╗      ██████╗ ██████╗ ███████╗', color: C.red },
        { text: '  ██╔════╝╚██╗ ██╔╝██╔════╝██║     ██╔═══██╗██╔══██╗██╔════╝', color: C.red },
        { text: '  ██║      ╚████╔╝ ██║     ██║     ██║   ██║██████╔╝███████╗', color: C.red },
        { text: '  ██║       ╚██╔╝  ██║     ██║     ██║   ██║██╔═══╝ ╚════██║', color: C.red },
        { text: '  ╚██████╗   ██║   ╚██████╗███████╗╚██████╔╝██║     ███████║', color: C.red },
        { text: '   ╚═════╝   ╚═╝    ╚═════╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝', color: C.red },
        { text: '  Unified OSINT Targeting Pipeline', color: C.dim },
        { text: '' },
        { text: '  Target:   smoke-wolf', color: C.white },
        { text: '  Type:     username (auto-detected)', parts: [
            { text: '  Type:     ', color: C.white },
            { text: 'username', color: C.cyan },
            { text: ' (auto-detected)', color: C.dim },
        ]},
        { text: '  Workflow: username_trace (5 phases)', parts: [
            { text: '  Workflow: username_trace ', color: C.white },
            { text: '(5 phases)', color: C.dim },
        ]},
    ]},
    { delay: 2.0, lines: [
        { text: '$ cyclops smoke-wolf', color: C.dim },
        { text: '' },
        { text: '  ▲ Starting...', parts: [
            { text: '  ▲ ', color: C.red },
            { text: 'Starting...', color: C.white },
        ]},
        { text: '' },
        { text: '  ⠙ smoke-wolf  username_trace  2s', parts: [
            { text: '  ⠙ ', color: C.red },
            { text: 'smoke-wolf', color: C.white, bold: true },
            { text: '  username_trace  2s', color: C.dim },
        ]},
        { text: '' },
        { text: '  0 entities  0 connectors  0/5 phases', color: C.white },
        { text: '  ░░░░░  [GitHub, Sherlock, Maigret]', parts: [
            { text: '  ░░░░░  ', color: C.dim },
            { text: '[GitHub, Sherlock, Maigret]', color: C.dim },
        ]},
        { text: '' },
        { text: '  ◆ phase platform_search', parts: [
            { text: '  ◆ ', color: C.yellow },
            { text: 'phase ', color: C.white },
            { text: 'platform_search', color: C.white, bold: true },
        ]},
    ]},
    { delay: 4.5, lines: [
        { text: '  ⠹ smoke-wolf  username_trace  8s', parts: [
            { text: '  ⠹ ', color: C.red },
            { text: 'smoke-wolf', color: C.white, bold: true },
            { text: '  username_trace  8s', color: C.dim },
        ]},
        { text: '' },
        { text: '  32 entities  4 connectors  1/5 phases', color: C.white },
        { text: '  █▓░░░  [WebScraper, DNS-Native]', parts: [
            { text: '  █', color: C.green },
            { text: '▓', color: C.yellow },
            { text: '░░░  ', color: C.dim },
            { text: '[WebScraper, DNS-Native]', color: C.dim },
        ]},
        { text: '  account:1 repository:29 person:1 email:1', parts: [
            { text: '  account:', color: C.white },
            { text: '1', color: C.white, bold: true },
            { text: ' repository:', color: C.white },
            { text: '29', color: C.white, bold: true },
            { text: ' person:', color: C.white },
            { text: '1', color: C.white, bold: true },
            { text: ' email:', color: C.white },
            { text: '1', color: C.white, bold: true },
        ]},
        { text: '' },
        { text: '  +29 via GitHub (smoke-wolf)', parts: [
            { text: '  +29', color: C.green },
            { text: ' via ', color: C.white },
            { text: 'GitHub', color: C.magenta },
            { text: ' (smoke-wolf)', color: C.dim },
        ]},
        { text: '  +1 via Sherlock (smoke-wolf)', parts: [
            { text: '  +1', color: C.green },
            { text: ' via ', color: C.white },
            { text: 'Sherlock', color: C.magenta },
            { text: ' (smoke-wolf)', color: C.dim },
        ]},
        { text: '  ◆ phase profile_scrape', parts: [
            { text: '  ◆ ', color: C.yellow },
            { text: 'phase ', color: C.white },
            { text: 'profile_scrape', color: C.white, bold: true },
        ]},
    ]},
    { delay: 7.0, lines: [
        { text: '  ⠴ smoke-wolf  username_trace  24s', parts: [
            { text: '  ⠴ ', color: C.red },
            { text: 'smoke-wolf', color: C.white, bold: true },
            { text: '  username_trace  24s', color: C.dim },
        ]},
        { text: '' },
        { text: '  53 entities  8 connectors  3/5 phases', color: C.white },
        { text: '  ███▓░  [idle]', parts: [
            { text: '  ███', color: C.green },
            { text: '▓', color: C.yellow },
            { text: '░  ', color: C.dim },
            { text: '[idle]', color: C.dim },
        ]},
        { text: '  repository:29 domain:9 url:7 account:3 phone:2 technology:2', parts: [
            { text: '  repository:', color: C.white },
            { text: '29', color: C.white, bold: true },
            { text: ' domain:', color: C.white },
            { text: '9', color: C.white, bold: true },
            { text: ' url:', color: C.white },
            { text: '7', color: C.white, bold: true },
            { text: ' account:', color: C.white },
            { text: '3', color: C.white, bold: true },
            { text: ' phone:', color: C.white },
            { text: '2', color: C.white, bold: true },
            { text: ' technology:', color: C.white },
            { text: '2', color: C.white, bold: true },
        ]},
        { text: '' },
        { text: '  +8 via WebScraper (smoke-wolf.dev)', parts: [
            { text: '  +8', color: C.green },
            { text: ' via ', color: C.white },
            { text: 'WebScraper', color: C.magenta },
            { text: ' (smoke-wolf.dev)', color: C.dim },
        ]},
        { text: '  +9 via DNS-Native (smoke-wolf.dev)', parts: [
            { text: '  +9', color: C.green },
            { text: ' via ', color: C.white },
            { text: 'DNS-Native', color: C.magenta },
            { text: ' (smoke-wolf.dev)', color: C.dim },
        ]},
        { text: '  ◆ phase correlation', parts: [
            { text: '  ◆ ', color: C.yellow },
            { text: 'phase ', color: C.white },
            { text: 'correlation', color: C.white, bold: true },
        ]},
    ]},
    { delay: 9.0, lines: [
        { text: '' },
        { text: '── COMPLETE ─────────────────────────────────────────────', color: C.dim },
        { text: '' },
        { text: '  ▲ smoke-wolf  f5aa2633', parts: [
            { text: '  ▲ ', color: C.green },
            { text: 'smoke-wolf', color: C.white, bold: true },
            { text: '  f5aa2633', color: C.dim },
        ]},
        { text: '  username_trace — 42.1s', color: C.dim },
        { text: '' },
        { text: '  53 entities  35 links  8 connectors  5 phases', color: C.white },
        { text: '' },
        { text: '  repository      29   ████████████████████████', parts: [
            { text: '  repository      29   ', color: C.white },
            { text: '████████████████████████', color: C.green },
        ]},
        { text: '  domain           9   ███████', parts: [
            { text: '  domain           9   ', color: C.white },
            { text: '███████', color: C.green },
        ]},
        { text: '  url              7   ██████', parts: [
            { text: '  url              7   ', color: C.white },
            { text: '██████', color: C.green },
        ]},
        { text: '  account          3   ██', parts: [
            { text: '  account          3   ', color: C.white },
            { text: '██', color: C.green },
        ]},
        { text: '  phone            2   ██', parts: [
            { text: '  phone            2   ', color: C.white },
            { text: '██', color: C.green },
        ]},
        { text: '  technology       2   ██', parts: [
            { text: '  technology       2   ', color: C.white },
            { text: '██', color: C.green },
        ]},
        { text: '  person           1   █', parts: [
            { text: '  person           1   ', color: C.white },
            { text: '█', color: C.green },
        ]},
        { text: '' },
        { text: '  ✔ platform_search            +40', parts: [
            { text: '  ✔ ', color: C.green },
            { text: 'platform_search            ', color: C.white },
            { text: '+40', color: C.green },
        ]},
        { text: '  ✔ profile_scrape             +13', parts: [
            { text: '  ✔ ', color: C.green },
            { text: 'profile_scrape             ', color: C.white },
            { text: '+13', color: C.green },
        ]},
        { text: '  ✔ identity_pivot             +0', parts: [
            { text: '  ✔ ', color: C.green },
            { text: 'identity_pivot             ', color: C.white },
            { text: '+0', color: C.dim },
        ]},
        { text: '  ✔ correlation                +0', parts: [
            { text: '  ✔ ', color: C.green },
            { text: 'correlation                ', color: C.white },
            { text: '+0', color: C.dim },
        ]},
        { text: '  ✔ reporting                  +0', parts: [
            { text: '  ✔ ', color: C.green },
            { text: 'reporting                  ', color: C.white },
            { text: '+0', color: C.dim },
        ]},
    ]},
    { delay: 11.5, lines: [
        { text: '' },
        { text: '── HIGH CONFIDENCE ──────────────────────────────────────', color: C.dim },
        { text: '' },
        { text: '  95% account GitHub/smoke-wolf (2 sources)', parts: [
            { text: '  95%', color: C.green },
            { text: ' account ', color: C.cyan },
            { text: 'GitHub/smoke-wolf ', color: C.white },
            { text: '(2 sources)', color: C.yellow },
        ]},
        { text: '  90% person  Maliq Barnard', parts: [
            { text: '  90%', color: C.green },
            { text: ' person  ', color: C.cyan },
            { text: 'Maliq Barnard', color: C.white },
        ]},
        { text: '  90% email   smoke@example.com (github_commit)', parts: [
            { text: '  90%', color: C.green },
            { text: ' email   ', color: C.cyan },
            { text: 'smoke@example.com ', color: C.white },
            { text: '(github_commit)', color: C.dim },
        ]},
        { text: '  85% account Twitter/smokewolf', parts: [
            { text: '  85%', color: C.green },
            { text: ' account ', color: C.cyan },
            { text: 'Twitter/smokewolf', color: C.white },
        ]},
        { text: '  80% domain  smoke-wolf.dev', parts: [
            { text: '  80%', color: C.green },
            { text: ' domain  ', color: C.cyan },
            { text: 'smoke-wolf.dev', color: C.white },
        ]},
        { text: '' },
        { text: '  View all: cyclops entities f5aa2633', color: C.dim },
        { text: '  Graph:    cyclops graph f5aa2633', color: C.dim },
        { text: '' },
    ]},
];

const lineHeight = 20;
const charWidth = 9.6;
const padX = 20;
const headerH = 36;
const maxCols = 75;
const width = padX * 2 + maxCols * charWidth;

// Calculate max lines across all frames
let maxLines = 0;
for (const frame of FRAMES) maxLines = Math.max(maxLines, frame.lines.length);
const contentH = maxLines * lineHeight + 40;
const height = headerH + contentH;

// Total animation duration
const totalDuration = FRAMES[FRAMES.length - 1].delay + 4;

function renderLine(line, y) {
    if (!line.text && !line.parts) return `<text y="${y}"></text>`;
    if (line.parts) {
        let x = padX;
        let tspans = '';
        for (const part of line.parts) {
            const weight = part.bold ? 'bold' : 'normal';
            tspans += `<tspan x="${x}" fill="${part.color || FG}" font-weight="${weight}">${esc(part.text)}</tspan>`;
            x += part.text.length * charWidth;
        }
        return `<text y="${y}">${tspans}</text>`;
    }
    const weight = line.bold ? 'bold' : 'normal';
    return `<text y="${y}"><tspan x="${padX}" fill="${line.color || FG}" font-weight="${weight}">${esc(line.text)}</tspan></text>`;
}

let svg = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
svg.push(`<defs><style>text { font-family: ${FONT}; font-size: 14px; }</style></defs>`);

// Terminal chrome
svg.push(`<rect width="${width}" height="${height}" rx="10" fill="${BG}"/>`);
svg.push(`<rect width="${width}" height="${headerH}" rx="10" fill="#161b22"/>`);
svg.push(`<rect x="0" y="26" width="${width}" height="10" fill="#161b22"/>`);
svg.push(`<circle cx="20" cy="18" r="6" fill="#ff5f57"/>`);
svg.push(`<circle cx="40" cy="18" r="6" fill="#febc2e"/>`);
svg.push(`<circle cx="60" cy="18" r="6" fill="#28c840"/>`);
svg.push(`<text x="${width / 2}" y="22" fill="${C.dim}" text-anchor="middle" font-size="13">cyclops smoke-wolf</text>`);

// Each frame is a group with animation
for (let f = 0; f < FRAMES.length; f++) {
    const frame = FRAMES[f];
    const nextDelay = f < FRAMES.length - 1 ? FRAMES[f + 1].delay : totalDuration;
    const visible = nextDelay - frame.delay;

    const startPct = ((frame.delay / totalDuration) * 100).toFixed(2);
    const endPct = ((nextDelay / totalDuration) * 100).toFixed(2);

    svg.push(`<g opacity="0">`);
    svg.push(`<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${(startPct / 100).toFixed(4)};${(startPct / 100).toFixed(4)};${(endPct / 100).toFixed(4)};${(endPct / 100).toFixed(4)};1" dur="${totalDuration}s" repeatCount="indefinite"/>`);

    let y = headerH + 30;
    for (const line of frame.lines) {
        svg.push(renderLine(line, y));
        y += lineHeight;
    }
    svg.push('</g>');
}

svg.push('</svg>');

writeFileSync(join(ASSETS, 'demo.svg'), svg.join('\n'));
console.log('✓ assets/demo.svg — animated terminal demo');
console.log(`  ${FRAMES.length} frames, ${totalDuration}s loop, ${width}x${height}px`);
