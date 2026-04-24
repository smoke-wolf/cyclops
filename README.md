# CYCLOPS

Unified OSINT targeting pipeline. Enter knowns, get intelligence.

Config-driven orchestration engine that fans out across 25 connectors in parallel, normalizes results into a unified entity graph, correlates across sources, and generates reports autonomously.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│   CLI / API  │────▶│    Engine     │────▶│  Connectors  │────▶│  External   │
│              │     │  (Workflow    │     │  (25 tools)  │     │  OSINT      │
│  cyclops     │     │   DAG exec)  │     │              │     │  Sources    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └────────────┘
       │                    │                    │
       │              ┌─────▼──────┐       ┌─────▼──────┐
       │              │  Correlator │       │  Telemetry  │
       │              │  (linking,  │       │  (SSE, WS,  │
       │              │   scoring)  │       │   SQLite)   │
       │              └─────┬──────┘       └────────────┘
       │              ┌─────▼──────┐
       └─────────────▶│  Reporter   │
                      │  (JSON,HTML │
                      │   Markdown) │
                      └─────────────┘
```

## Quick Start

```bash
npm install
node cyclops.js investigate -n "target" -w person_full \
  --known username:johndoe --known email:john@example.com
```

### Dashboard

```bash
node cyclops.js serve --port 3100
# http://localhost:3100
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `investigate` | Launch a new investigation |
| `list` | List all investigations |
| `status <id>` | Show investigation status |
| `report <id>` | Generate report |
| `connectors` | List connectors |
| `serve` | Start dashboard server |

## Connectors (25)

### Native (no install, work out of the box)

| Connector | Type | Accepts | Outputs |
|-----------|------|---------|---------|
| GitHub | Code platform | username | accounts, repos, emails, orgs, collaborators |
| DNS-Native | DNS enumeration | domain | IPs, subdomains, records, SPF/DMARC emails |
| WHOIS-Native | Domain registration | domain | registrar, nameservers, contacts |
| crt.sh | Certificate transparency | domain | subdomains, certificates |
| HaveIBeenPwned | Breach lookup | email | breaches, pastes |
| WebScraper | Web intelligence | url, domain | emails, social accounts, phones, tech stack |
| Wayback Machine | Historical archive | domain | archived URLs, interesting files, API endpoints |
| IP-API | IP geolocation | ip | geo, ASN, reverse DNS, proxy detection |
| EmailRep | Email reputation | email | reputation, profiles, breach flags |

### Binary (install separately)

| Connector | Type | Install |
|-----------|------|---------|
| Sherlock | Username enum | `pip3 install sherlock-project` |
| Holehe | Email enum | `pip3 install holehe` |
| Maigret | Username deep | `pip3 install maigret` |
| theHarvester | Domain recon | `pip3 install theHarvester` |
| Amass | Subdomain enum | `go install github.com/owasp-amass/amass/v4/...@master` |
| Subfinder | Subdomain enum | `go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest` |
| Shodan | IP recon | `pip3 install shodan` |
| Censys | Cert recon | `pip3 install censys` |
| PhoneInfoga | Phone recon | `go install github.com/sundowndev/phoneinfoga/v2@latest` |
| h8mail | Breach lookup | `pip3 install h8mail` |
| WhatsMyName | Username enum | `pip3 install whatsmyname` |
| socialscan | Availability | `pip3 install socialscan` |
| Photon | Web crawler | `pip3 install photon` |
| GHunt | Google OSINT | `pip3 install ghunt` |
| Nmap | Port scan | `brew install nmap` |
| DNSrecon | DNS enum | `pip3 install dnsrecon` |

Binary connectors are auto-skipped if not installed. Native connectors always run.

## Workflows

### person_full
Full person investigation. Seed expansion → breach check → infrastructure mapping → deep profiling → correlation → reporting.

### domain_recon
Infrastructure and personnel enumeration from a domain. Subdomain enum → service discovery → personnel harvest → email enum → correlation → reporting.

### username_trace
Trace a username across platforms. Platform search → profile scrape → identity pivot → correlation → reporting.

### quick_recon
60-second surface sweep.

## Entity Graph

The correlation engine links entities across tools using fuzzy matching and confidence scoring. Multi-source corroboration boosts confidence. The graph visualizer (`/graph.html`) renders the entity network with force-directed layout, drag, zoom, and hover inspection.

**Entity types:** person, account, email, domain, subdomain, ip, port, certificate, breach, credential, phone, url, dns_record, repository, organization, technology

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/investigate` | Launch (blocking) |
| POST | `/api/investigate/async` | Launch (non-blocking) |
| GET | `/api/investigations` | List all |
| GET | `/api/investigation/:id` | Status + stats |
| GET | `/api/investigation/:id/entities` | Entity list |
| GET | `/api/investigation/:id/knowns` | Known inputs |
| GET | `/api/investigation/:id/graph` | Entity graph |
| GET | `/api/investigation/:id/report?format=html` | Report |
| POST | `/api/investigation/:id/abort` | Abort |
| GET | `/api/connectors` | Connector list |
| GET | `/api/connectors/health` | Health check |
| GET | `/api/workflows` | Workflow list |
| GET | `/api/events` | SSE event stream |

## Configuration

All behavior is config-driven:

- `config/connectors.json` — connector definitions, timeouts, API keys
- `config/workflows.json` — workflow phases, dependencies, connector assignments
- `config/correlation.json` — entity types, linking rules, scoring parameters

## API Keys (Optional)

```bash
export SHODAN_API_KEY=...
export CENSYS_API_ID=...
export CENSYS_API_SECRET=...
export HIBP_API_KEY=...
export EMAILREP_API_KEY=...
export GITHUB_TOKEN=...    # raises rate limit from 60 to 5000 req/hr
```

## Testing

```bash
node test/run.js           # unit + live connector tests
node test/deep_recon.js    # full investigation with telemetry output
```
