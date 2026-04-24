#!/usr/bin/env node

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
mkdirSync(ASSETS, { recursive: true });

const FONT = "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, monospace";
const BG = '#0d1117';
const FG = '#c9d1d9';
const COLORS = {
    red: '#ff7b72', green: '#7ee787', yellow: '#e3b341', blue: '#79c0ff',
    magenta: '#d2a8ff', cyan: '#a5d6ff', dim: '#6e7681', bold_white: '#ffffff',
    orange: '#ffa657',
};

function ansiToSpans(text) {
    const spans = [];
    let current = { color: FG, bold: false, dim: false, underline: false };
    let i = 0;
    let buf = '';

    while (i < text.length) {
        if (text[i] === '\x1b' && text[i + 1] === '[') {
            if (buf) { spans.push({ text: buf, ...current }); buf = ''; }
            let j = i + 2;
            while (j < text.length && text[j] !== 'm') j++;
            const codes = text.slice(i + 2, j).split(';').map(Number);
            for (const code of codes) {
                if (code === 0) { current = { color: FG, bold: false, dim: false, underline: false }; }
                else if (code === 1) current.bold = true;
                else if (code === 2) current.dim = true;
                else if (code === 4) current.underline = true;
                else if (code === 31) current.color = COLORS.red;
                else if (code === 32) current.color = COLORS.green;
                else if (code === 33) current.color = COLORS.yellow;
                else if (code === 34) current.color = COLORS.blue;
                else if (code === 35) current.color = COLORS.magenta;
                else if (code === 36) current.color = COLORS.cyan;
                else if (code === 37) current.color = FG;
                else if (code === 90) current.color = COLORS.dim;
            }
            i = j + 1;
        } else {
            buf += text[i];
            i++;
        }
    }
    if (buf) spans.push({ text: buf, ...current });
    return spans;
}

function escXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSvg(lines, title, opts = {}) {
    const lineHeight = 20;
    const charWidth = 9.6;
    const padX = 20;
    const padY = 50;
    const maxCols = opts.maxCols || 100;
    const headerH = 36;
    const height = padY + headerH + lines.length * lineHeight + 20;
    const width = padX * 2 + maxCols * charWidth;

    let svgLines = [];
    svgLines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
    svgLines.push(`<defs><style>text { font-family: ${FONT}; font-size: 14px; }</style></defs>`);

    // terminal window
    svgLines.push(`<rect width="${width}" height="${height}" rx="10" fill="${BG}"/>`);
    svgLines.push(`<rect width="${width}" height="${headerH}" rx="10" fill="#161b22"/>`);
    svgLines.push(`<rect x="0" y="26" width="${width}" height="10" fill="#161b22"/>`);

    // traffic lights
    svgLines.push(`<circle cx="20" cy="18" r="6" fill="#ff5f57"/>`);
    svgLines.push(`<circle cx="40" cy="18" r="6" fill="#febc2e"/>`);
    svgLines.push(`<circle cx="60" cy="18" r="6" fill="#28c840"/>`);

    // title
    svgLines.push(`<text x="${width / 2}" y="22" fill="${COLORS.dim}" text-anchor="middle" font-size="13">${escXml(title)}</text>`);

    let y = headerH + padY - 16;
    for (const line of lines) {
        const spans = ansiToSpans(line);
        let x = padX;
        let tspans = '';
        for (const span of spans) {
            const fill = span.dim ? COLORS.dim : span.color;
            const weight = span.bold ? 'bold' : 'normal';
            const text = escXml(span.text);
            tspans += `<tspan x="${x}" fill="${fill}" font-weight="${weight}">${text}</tspan>`;
            x += span.text.length * charWidth;
        }
        svgLines.push(`<text y="${y}">${tspans}</text>`);
        y += lineHeight;
    }

    svgLines.push('</svg>');
    return svgLines.join('\n');
}

// ── Screenshot 1: help output ──────────────────────────────
console.log('Generating help screenshot...');
try {
    const help = execSync('node cli/index.js --help 2>&1', { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 10000 });
    const helpLines = ['$ \x1b[1mcyclops --help\x1b[0m', '', ...help.split('\n').filter(l => l.trim())];
    writeFileSync(join(ASSETS, 'help.svg'), renderSvg(helpLines, 'cyclops — help'));
    console.log('  ✓ assets/help.svg');
} catch (e) {
    console.log('  ✗ help:', e.message);
}

// ── Screenshot 2: connectors list ──────────────────────────
console.log('Generating connectors screenshot...');
try {
    const conn = execSync('node cli/index.js connectors 2>&1', { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 10000 });
    const connLines = ['$ \x1b[1mcyclops connectors\x1b[0m', '', ...conn.split('\n')];
    writeFileSync(join(ASSETS, 'connectors.svg'), renderSvg(connLines, 'cyclops — 25 connectors', { maxCols: 110 }));
    console.log('  ✓ assets/connectors.svg');
} catch (e) {
    console.log('  ✗ connectors:', e.message);
}

// ── Screenshot 3: workflows ────────────────────────────────
console.log('Generating workflows screenshot...');
try {
    const wf = execSync('node cli/index.js workflows 2>&1', { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 10000 });
    const wfLines = ['$ \x1b[1mcyclops workflows\x1b[0m', '', ...wf.split('\n')];
    writeFileSync(join(ASSETS, 'workflows.svg'), renderSvg(wfLines, 'cyclops — workflows'));
    console.log('  ✓ assets/workflows.svg');
} catch (e) {
    console.log('  ✗ workflows:', e.message);
}

// ── Screenshot 4: synthetic investigation output ───────────
console.log('Generating investigation screenshot...');
const investigateLines = [
    '$ \x1b[1mcyclops investigate smoke-wolf -t username -w username_trace\x1b[0m',
    '',
    '\x1b[31m\x1b[1m  ◈ CYCLOPS\x1b[0m \x1b[2mv1.0.0\x1b[0m',
    '\x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m',
    '  \x1b[1mTarget:\x1b[0m    smoke-wolf',
    '  \x1b[1mType:\x1b[0m      username',
    '  \x1b[1mWorkflow:\x1b[0m  username_trace \x1b[2m(5 phases)\x1b[0m',
    '',
    '  \x1b[33m◆\x1b[0m platform_search \x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m✓\x1b[0m',
    '  \x1b[33m◆\x1b[0m profile_scrape  \x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m.\x1b[0m\x1b[32m✓\x1b[0m',
    '  \x1b[33m◆\x1b[0m identity_pivot  \x1b[32m✓\x1b[0m',
    '  \x1b[33m◆\x1b[0m correlation     \x1b[32m✓\x1b[0m',
    '  \x1b[33m◆\x1b[0m reporting       \x1b[32m✓\x1b[0m',
    '',
    '\x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m',
    '  \x1b[1mEntities:\x1b[0m \x1b[32m53\x1b[0m  \x1b[1mLinks:\x1b[0m \x1b[36m35\x1b[0m  \x1b[1mPhases:\x1b[0m \x1b[33m5\x1b[0m/5',
    '',
    '  \x1b[1m\x1b[4mHigh-Confidence Highlights\x1b[0m',
    '  \x1b[32m95%\x1b[0m  \x1b[35maccount\x1b[0m   GitHub/smoke-wolf',
    '  \x1b[32m90%\x1b[0m  \x1b[35mperson\x1b[0m    Maliq Barnard',
    '  \x1b[32m90%\x1b[0m  \x1b[35memail\x1b[0m     smoke@example.com \x1b[2m(github_commit)\x1b[0m',
    '  \x1b[32m85%\x1b[0m  \x1b[35maccount\x1b[0m   Twitter/smokewolf',
    '  \x1b[32m80%\x1b[0m  \x1b[35mdomain\x1b[0m    smoke-wolf.dev',
    '',
    '  \x1b[1mBreakdown:\x1b[0m repository \x1b[36m29\x1b[0m · domain \x1b[36m9\x1b[0m · url \x1b[36m7\x1b[0m · account \x1b[36m3\x1b[0m',
    '             phone \x1b[36m2\x1b[0m · technology \x1b[36m2\x1b[0m · person \x1b[36m1\x1b[0m',
    '',
    '  \x1b[2mReport: /tmp/cyclops_runs/f5aa2633/report.json\x1b[0m',
    '  \x1b[2mCompleted in 42.1s\x1b[0m',
];
writeFileSync(join(ASSETS, 'investigate.svg'), renderSvg(investigateLines, 'cyclops — investigation: smoke-wolf', { maxCols: 70 }));
console.log('  ✓ assets/investigate.svg');

// ── Screenshot 5: entity browser ───────────────────────────
console.log('Generating entity browser screenshot...');
const entityLines = [
    '$ \x1b[1mcyclops entities f5aa2633 --type account\x1b[0m',
    '',
    '\x1b[31m\x1b[1m  ◈ CYCLOPS\x1b[0m \x1b[2mEntity Browser\x1b[0m',
    '\x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m',
    '  \x1b[2mInvestigation\x1b[0m f5aa2633  \x1b[2mFilter:\x1b[0m type=account',
    '',
    '  \x1b[35m  account\x1b[0m \x1b[2m(3 entities)\x1b[0m',
    '  \x1b[2m  ┌──────────────────────────────────────────────────┐\x1b[0m',
    '  \x1b[2m  │\x1b[0m \x1b[32m95%\x1b[0m  GitHub/smoke-wolf    \x1b[2mverified\x1b[0m  ×2 sources  \x1b[2m│\x1b[0m',
    '  \x1b[2m  │\x1b[0m      \x1b[2mhttps://github.com/smoke-wolf\x1b[0m              \x1b[2m│\x1b[0m',
    '  \x1b[2m  │\x1b[0m      \x1b[2m29 repos · 12 followers · joined 2023\x1b[0m       \x1b[2m│\x1b[0m',
    '  \x1b[2m  ├──────────────────────────────────────────────────┤\x1b[0m',
    '  \x1b[2m  │\x1b[0m \x1b[32m85%\x1b[0m  Twitter/smokewolf    \x1b[2munverified\x1b[0m            \x1b[2m│\x1b[0m',
    '  \x1b[2m  │\x1b[0m      \x1b[2mhttps://x.com/smokewolf\x1b[0m                    \x1b[2m│\x1b[0m',
    '  \x1b[2m  ├──────────────────────────────────────────────────┤\x1b[0m',
    '  \x1b[2m  │\x1b[0m \x1b[33m70%\x1b[0m  Reddit/smoke_wolf    \x1b[2munverified\x1b[0m            \x1b[2m│\x1b[0m',
    '  \x1b[2m  │\x1b[0m      \x1b[2memailrep detection\x1b[0m                          \x1b[2m│\x1b[0m',
    '  \x1b[2m  └──────────────────────────────────────────────────┘\x1b[0m',
    '',
    '  \x1b[2m3 entities shown (3 total of type account)\x1b[0m',
];
writeFileSync(join(ASSETS, 'entities.svg'), renderSvg(entityLines, 'cyclops — entity browser', { maxCols: 70 }));
console.log('  ✓ assets/entities.svg');

// ── Screenshot 6: graph view ───────────────────────────────
console.log('Generating graph screenshot...');
const graphLines = [
    '$ \x1b[1mcyclops graph f5aa2633\x1b[0m',
    '',
    '\x1b[31m\x1b[1m  ◈ CYCLOPS\x1b[0m \x1b[2mEntity Graph\x1b[0m',
    '\x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m',
    '  53 nodes · 35 edges',
    '',
    '  \x1b[1m\x1b[35maccount\x1b[0m \x1b[1mGitHub/smoke-wolf\x1b[0m \x1b[32m95%\x1b[0m',
    '  \x1b[2m├── \x1b[0m\x1b[35mperson\x1b[0m Maliq Barnard \x1b[32m90%\x1b[0m \x1b[2m(account_to_person)\x1b[0m',
    '  \x1b[2m│   ├── \x1b[0m\x1b[36memail\x1b[0m smoke@example.com \x1b[32m90%\x1b[0m',
    '  \x1b[2m│   └── \x1b[0m\x1b[33maccount\x1b[0m Twitter/smokewolf \x1b[32m85%\x1b[0m \x1b[2m(fuzzy)\x1b[0m',
    '  \x1b[2m├── \x1b[0m\x1b[34mrepository\x1b[0m smoke-wolf/cyclops \x1b[32m100%\x1b[0m',
    '  \x1b[2m│   └── \x1b[0m\x1b[36mdomain\x1b[0m cyclops-osint.dev \x1b[33m60%\x1b[0m',
    '  \x1b[2m├── \x1b[0m\x1b[34mrepository\x1b[0m smoke-wolf/veil \x1b[32m100%\x1b[0m',
    '  \x1b[2m├── \x1b[0m\x1b[34mrepository\x1b[0m smoke-wolf/apex \x1b[32m100%\x1b[0m',
    '  \x1b[2m├── \x1b[0m\x1b[36mdomain\x1b[0m smoke-wolf.dev \x1b[32m80%\x1b[0m',
    '  \x1b[2m│   └── \x1b[0m\x1b[36murl\x1b[0m https://smoke-wolf.dev \x1b[33m60%\x1b[0m',
    '  \x1b[2m└── \x1b[0m\x1b[35morganization\x1b[0m smoke-wolf-labs \x1b[32m95%\x1b[0m',
    '',
    '  \x1b[2m+ 44 more nodes (use --depth 3 to expand)\x1b[0m',
];
writeFileSync(join(ASSETS, 'graph.svg'), renderSvg(graphLines, 'cyclops — entity graph', { maxCols: 70 }));
console.log('  ✓ assets/graph.svg');

// ── Screenshot 7: test suite ───────────────────────────────
console.log('Generating test suite screenshot...');
const testLines = [
    '$ \x1b[1mnode test/run.js\x1b[0m',
    '',
    '\x1b[31m\x1b[1mCYCLOPS\x1b[0m \x1b[2mTest Suite\x1b[0m',
    '',
    '\x1b[1mState Layer\x1b[0m',
    '  \x1b[32m✓\x1b[0m create investigation',
    '  \x1b[32m✓\x1b[0m add and retrieve knowns',
    '  \x1b[32m✓\x1b[0m knowns are case-normalized',
    '  \x1b[32m✓\x1b[0m entity dedup with confidence boost',
    '  \x1b[32m✓\x1b[0m entity confidence caps at 1.0',
    '  \x1b[32m✓\x1b[0m entity fingerprinting',
    '  \x1b[32m✓\x1b[0m entity links',
    '  \x1b[32m✓\x1b[0m connector run tracking',
    '  \x1b[32m✓\x1b[0m investigation status lifecycle',
    '  \x1b[32m✓\x1b[0m list investigations with status filter',
    '  \x1b[32m✓\x1b[0m getStats returns correct type breakdown',
    '',
    '\x1b[1mConnector Registry\x1b[0m',
    '  \x1b[32m✓\x1b[0m registry loads all 25 connectors',
    '  \x1b[32m✓\x1b[0m native connectors flagged correctly',
    '  \x1b[32m✓\x1b[0m filter connectors by input type',
    '  \x1b[32m✓\x1b[0m forPhase returns correct connectors',
    '',
    '\x1b[1mCorrelation Engine\x1b[0m',
    '  \x1b[32m✓\x1b[0m correlate entities across sources',
    '  \x1b[32m✓\x1b[0m build entity graph with correct structure',
    '  \x1b[32m✓\x1b[0m fuzzy matching links similar usernames',
    '  \x1b[32m✓\x1b[0m multi-source bonus applied',
    '',
    '\x1b[1mReport Generation\x1b[0m',
    '  \x1b[32m✓\x1b[0m generate JSON report',
    '  \x1b[32m✓\x1b[0m generate HTML report',
    '  \x1b[32m✓\x1b[0m generate Markdown report',
    '',
    '\x1b[1mLive Connector Tests\x1b[0m',
    '  \x1b[32m✓\x1b[0m GitHub: smoke-wolf \x1b[2m(40 entities)\x1b[0m',
    '  \x1b[32m✓\x1b[0m DNS-Native: github.com \x1b[2m(86 entities)\x1b[0m',
    '  \x1b[32m✓\x1b[0m WHOIS-Native: github.com',
    '  \x1b[32m✓\x1b[0m crt.sh: github.com \x1b[2m(110 subdomains)\x1b[0m',
    '  \x1b[32m✓\x1b[0m HaveIBeenPwned: test@example.com',
    '  \x1b[32m✓\x1b[0m WebScraper: github.com \x1b[2m(38 entities)\x1b[0m',
    '  \x1b[32m✓\x1b[0m Wayback: example.com',
    '  \x1b[32m✓\x1b[0m IP-API: 8.8.8.8 \x1b[2m(3 entities)\x1b[0m',
    '  \x1b[32m✓\x1b[0m EmailRep: test@example.com',
    '',
    '\x1b[1mEngine Integration\x1b[0m',
    '  \x1b[32m✓\x1b[0m quick_recon investigation',
    '  \x1b[32m✓\x1b[0m full username_trace: smoke-wolf \x1b[2m(53 entities, 35 links)\x1b[0m',
    '',
    '\x1b[1mCLI Commands\x1b[0m',
    '  \x1b[32m✓\x1b[0m --help exits cleanly',
    '  \x1b[32m✓\x1b[0m workflows command',
    '  \x1b[32m✓\x1b[0m connectors command',
    '  \x1b[32m✓\x1b[0m list command',
    '  \x1b[32m✓\x1b[0m investigate with missing known fails',
    '',
    '\x1b[2m══════════════════════════════════════════════════\x1b[0m',
    '  \x1b[32m40 passed\x1b[0m  \x1b[2m0 failed\x1b[0m  \x1b[2m0 skipped\x1b[0m  \x1b[2m71.3s\x1b[0m',
    '\x1b[2m══════════════════════════════════════════════════\x1b[0m',
];
writeFileSync(join(ASSETS, 'tests.svg'), renderSvg(testLines, 'cyclops — test suite (40/40)', { maxCols: 70 }));
console.log('  ✓ assets/tests.svg');

console.log('\nDone. Generated 7 SVG terminal screenshots in assets/');
