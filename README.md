# CYCLOPS

Unified OSINT targeting pipeline — 32 connectors, entity graph correlation, auto-reporting.

## Install

```bash
pip install cyclops-osint
```

## Quick Start

```bash
# Investigate a domain
cyclops example.com

# Investigate an email
cyclops user@example.com

# Investigate an IP
cyclops 8.8.8.8

# List connectors
cyclops connectors

# List workflows
cyclops workflows
```

## Connectors

32 connectors across 6 categories:

### Native (16)
| Connector | Type | API Key |
|-----------|------|---------|
| GitHub | username, email | Optional |
| DNS | domain | - |
| WHOIS | domain | - |
| crt.sh | domain | - |
| HaveIBeenPwned | email | Optional |
| Web Scraper | domain, url | - |
| Wayback Machine | domain, url | - |
| IP-API | ip | Optional |
| EmailRep | email | Optional |
| VirusTotal | domain, ip, url | Required |
| Hunter | domain, email | Required |
| SecurityTrails | domain, ip | Required |
| Shodan InternetDB | ip | - |
| AlienVault OTX | domain, ip | Optional |
| AbuseIPDB | ip | Required |
| URLScan | domain, url | Optional |

### Binary (16)
Sherlock, Holehe, Maigret, theHarvester, Amass, Subfinder, Nmap, Masscan, WhatWeb, Exiftool, Shodan CLI, Censys, h8mail, SpiderFoot, Recon-ng, BBOT

## Features

- Auto-detect input type (email, domain, IP, URL, phone, username)
- DAG-based workflow engine with dependency resolution
- Entity graph with SHA-256 dedup and fuzzy correlation
- Parallel async connector execution
- Reports: JSON, HTML, Markdown
- SQLite state with WAL mode

## License

MIT
