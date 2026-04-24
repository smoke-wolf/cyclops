import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Engine } from '../core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, '..', '..', 'dashboard');
const DB_PATH = join(__dirname, '..', '..', 'cyclops.db');

const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

const engine = new Engine(DB_PATH);
const sseClients = new Set();

engine.telemetry.onEvent(event => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) {
        try { res.write(data); } catch { sseClients.delete(res); }
    }
    for (const ws of wss?.clients || []) {
        if (ws.readyState === 1) ws.send(JSON.stringify(event));
    }
});

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid json')); } });
    });
}

function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}

function notFound(res) { json(res, { error: 'not found' }, 404); }

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    // SSE stream
    if (path === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
            'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*'
        });
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    // API routes
    if (path.startsWith('/api/')) {
        try {
            // POST /api/investigate — launch investigation
            if (path === '/api/investigate' && method === 'POST') {
                const body = await parseBody(req);
                if (!body.name || !body.knowns?.length) {
                    return json(res, { error: 'name and knowns[] required' }, 400);
                }
                const id = await engine.investigate(body.name, body.knowns, body.workflow, body.config);
                return json(res, { id, status: 'completed' });
            }

            // POST /api/investigate/async — launch without waiting
            if (path === '/api/investigate/async' && method === 'POST') {
                const body = await parseBody(req);
                if (!body.name || !body.knowns?.length) {
                    return json(res, { error: 'name and knowns[] required' }, 400);
                }
                const investigationId = engine.state.createInvestigation(body.name, body.workflow || 'person_full', body.config || {});
                for (const known of body.knowns) {
                    engine.state.addKnown(investigationId, known.type, known.value);
                }
                engine.investigate(body.name, body.knowns, body.workflow, body.config).catch(() => {});
                return json(res, { id: investigationId, status: 'running' });
            }

            // GET /api/investigations
            if (path === '/api/investigations' && method === 'GET') {
                const status = url.searchParams.get('status');
                return json(res, engine.state.listInvestigations(status));
            }

            // GET /api/investigation/:id
            const invMatch = path.match(/^\/api\/investigation\/([^/]+)$/);
            if (invMatch && method === 'GET') {
                const status = engine.getStatus(invMatch[1]);
                if (!status.investigation) return notFound(res);
                return json(res, status);
            }

            // GET /api/investigation/:id/entities
            const entMatch = path.match(/^\/api\/investigation\/([^/]+)\/entities$/);
            if (entMatch && method === 'GET') {
                const type = url.searchParams.get('type');
                return json(res, engine.state.getEntities(entMatch[1], type));
            }

            // GET /api/investigation/:id/graph
            const graphMatch = path.match(/^\/api\/investigation\/([^/]+)\/graph$/);
            if (graphMatch && method === 'GET') {
                const graph = engine.correlator.buildGraph(graphMatch[1]);
                return json(res, graph);
            }

            // GET /api/investigation/:id/report
            const reportMatch = path.match(/^\/api\/investigation\/([^/]+)\/report$/);
            if (reportMatch && method === 'GET') {
                const format = url.searchParams.get('format') || 'json';
                const path = await engine.reporter.generate(reportMatch[1], format);
                const content = readFileSync(path, 'utf-8');
                if (format === 'html') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    return res.end(content);
                }
                return json(res, JSON.parse(content));
            }

            // POST /api/investigation/:id/abort
            const abortMatch = path.match(/^\/api\/investigation\/([^/]+)\/abort$/);
            if (abortMatch && method === 'POST') {
                engine.abort(abortMatch[1]);
                return json(res, { status: 'aborting' });
            }

            // GET /api/connectors
            if (path === '/api/connectors' && method === 'GET') {
                return json(res, engine.registry.list());
            }

            // GET /api/connectors/health
            if (path === '/api/connectors/health' && method === 'GET') {
                const results = await engine.registry.checkHealth();
                return json(res, { connectors: results, summary: engine.registry.getHealthSummary() });
            }

            // GET /api/workflows
            if (path === '/api/workflows' && method === 'GET') {
                return json(res, engine.workflows.workflows);
            }

            return notFound(res);
        } catch (e) {
            return json(res, { error: e.message }, 500);
        }
    }

    // Static dashboard files
    let filePath = join(DASHBOARD_DIR, path === '/' ? 'index.html' : path);
    if (!existsSync(filePath)) {
        filePath = join(DASHBOARD_DIR, 'index.html');
    }

    try {
        const content = readFileSync(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
    } catch {
        notFound(res);
    }
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'connected', connectors: engine.registry.list().length }));
});

const PORT = process.env.CYCLOPS_PORT || 3100;
server.listen(PORT, () => {
    console.log(`\x1b[31m▲ CYCLOPS\x1b[0m listening on http://localhost:${PORT}`);
    console.log(`  Dashboard: http://localhost:${PORT}`);
    console.log(`  API:       http://localhost:${PORT}/api`);
    console.log(`  Events:    http://localhost:${PORT}/api/events`);
});

process.on('SIGINT', () => { engine.close(); process.exit(0); });
process.on('SIGTERM', () => { engine.close(); process.exit(0); });
