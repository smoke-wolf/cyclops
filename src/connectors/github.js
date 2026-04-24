import { BaseConnector } from './base.js';
import https from 'https';

export class GitHubConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'GitHub';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];

            if (inputType === 'username') {
                const user = await this._apiGet(`/users/${inputValue}`);
                if (user && !user.message) {
                    entities.push({
                        type: 'account',
                        data: {
                            platform: 'GitHub',
                            username: user.login,
                            url: user.html_url,
                            bio: user.bio,
                            name: user.name,
                            company: user.company,
                            location: user.location,
                            blog: user.blog,
                            twitter_username: user.twitter_username,
                            followers: user.followers,
                            following: user.following,
                            public_repos: user.public_repos,
                            created_at: user.created_at,
                            avatar_url: user.avatar_url,
                            verified: true
                        },
                        confidence: 0.95
                    });

                    if (user.name) {
                        entities.push({
                            type: 'person',
                            data: { name: user.name, username: user.login, location: user.location, bio: user.bio },
                            confidence: 0.9,
                            asKnown: { type: 'name', value: user.name }
                        });
                    }

                    if (user.blog) {
                        entities.push({
                            type: 'url',
                            data: { url: user.blog, source: 'github_profile' },
                            confidence: 0.9,
                            asKnown: { type: 'url', value: user.blog }
                        });
                        try {
                            const domain = new URL(user.blog.startsWith('http') ? user.blog : `https://${user.blog}`).hostname;
                            entities.push({
                                type: 'domain',
                                data: { name: domain, source: 'github_profile' },
                                confidence: 0.7,
                                asKnown: { type: 'domain', value: domain }
                            });
                        } catch {}
                    }

                    if (user.twitter_username) {
                        entities.push({
                            type: 'account',
                            data: { platform: 'Twitter', username: user.twitter_username, url: `https://x.com/${user.twitter_username}`, verified: false },
                            confidence: 0.85,
                            asKnown: { type: 'username', value: user.twitter_username }
                        });
                    }

                    if (user.email) {
                        entities.push({
                            type: 'email',
                            data: { address: user.email, source: 'github_profile', verified: true },
                            confidence: 0.95,
                            asKnown: { type: 'email', value: user.email }
                        });
                    }

                    const repos = await this._apiGet(`/users/${inputValue}/repos?sort=updated&per_page=30`);
                    if (Array.isArray(repos)) {
                        for (const repo of repos) {
                            entities.push({
                                type: 'repository',
                                data: {
                                    name: repo.full_name,
                                    url: repo.html_url,
                                    description: repo.description,
                                    language: repo.language,
                                    stars: repo.stargazers_count,
                                    forks: repo.forks_count,
                                    created_at: repo.created_at,
                                    updated_at: repo.updated_at,
                                    homepage: repo.homepage,
                                    topics: repo.topics
                                },
                                confidence: 1.0
                            });

                            if (repo.homepage) {
                                try {
                                    const domain = new URL(repo.homepage.startsWith('http') ? repo.homepage : `https://${repo.homepage}`).hostname;
                                    entities.push({
                                        type: 'domain',
                                        data: { name: domain, source: `github_repo:${repo.full_name}` },
                                        confidence: 0.6,
                                        asKnown: { type: 'domain', value: domain }
                                    });
                                } catch {}
                            }
                        }
                    }

                    const events = await this._apiGet(`/users/${inputValue}/events/public?per_page=100`);
                    if (Array.isArray(events)) {
                        const emailsSeen = new Set();
                        for (const event of events) {
                            if (event.type === 'PushEvent' && event.payload?.commits) {
                                for (const commit of event.payload.commits) {
                                    if (commit.author?.email && !emailsSeen.has(commit.author.email)) {
                                        emailsSeen.add(commit.author.email);
                                        if (!commit.author.email.includes('noreply.github.com')) {
                                            entities.push({
                                                type: 'email',
                                                data: {
                                                    address: commit.author.email,
                                                    source: 'github_commit',
                                                    author_name: commit.author.name,
                                                    repo: event.repo?.name
                                                },
                                                confidence: 0.9,
                                                asKnown: { type: 'email', value: commit.author.email }
                                            });
                                        }
                                    }
                                    if (commit.author?.name) {
                                        entities.push({
                                            type: 'person',
                                            data: { name: commit.author.name, source: 'github_commit' },
                                            confidence: 0.7
                                        });
                                    }
                                }
                            }
                        }

                        const collaborators = new Set();
                        for (const event of events) {
                            if (event.type === 'PushEvent' && event.payload?.commits) {
                                for (const commit of event.payload.commits) {
                                    if (commit.author?.name && commit.author.name !== user.name && commit.author.name !== user.login) {
                                        collaborators.add(JSON.stringify({ name: commit.author.name, email: commit.author.email }));
                                    }
                                }
                            }
                        }
                        for (const collab of collaborators) {
                            const c = JSON.parse(collab);
                            entities.push({
                                type: 'person',
                                data: { name: c.name, email: c.email, relationship: 'github_collaborator', target_user: inputValue },
                                confidence: 0.6
                            });
                        }
                    }

                    const orgs = await this._apiGet(`/users/${inputValue}/orgs`);
                    if (Array.isArray(orgs)) {
                        for (const org of orgs) {
                            entities.push({
                                type: 'organization',
                                data: {
                                    name: org.login,
                                    url: `https://github.com/${org.login}`,
                                    avatar_url: org.avatar_url,
                                    description: org.description
                                },
                                confidence: 0.95
                            });
                        }
                    }

                    const gists = await this._apiGet(`/users/${inputValue}/gists?per_page=30`);
                    if (Array.isArray(gists)) {
                        for (const gist of gists) {
                            entities.push({
                                type: 'url',
                                data: {
                                    url: gist.html_url,
                                    title: gist.description || Object.keys(gist.files || {})[0],
                                    source: 'github_gist',
                                    files: Object.keys(gist.files || {}),
                                    public: gist.public
                                },
                                confidence: 0.8
                            });
                        }
                    }
                }
            }

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence || 0.5);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);
                if (entity.asKnown) {
                    this.state.addKnown(investigationId, entity.asKnown.type, entity.asKnown.value, this.name, entity.confidence || 0.5);
                }
            }

            this.state.completeConnectorRun(runId, 'completed', newCount, null, null, 0);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'completed', entitiesFound: newCount, input: { type: inputType, value: inputValue }
            });
            return { status: 'completed', entities, newCount };
        } catch (e) {
            this.state.completeConnectorRun(runId, 'failed', 0, null, e.message, 1);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'failed', entitiesFound: 0, input: { type: inputType, value: inputValue }
            });
            this.telemetry.error(investigationId, this.name, e.message, phaseId);
            return { status: 'failed', error: e.message };
        }
    }

    _apiGet(path) {
        return new Promise((resolve, reject) => {
            const opts = {
                hostname: 'api.github.com',
                path,
                headers: { 'User-Agent': 'cyclops-osint', 'Accept': 'application/vnd.github.v3+json' },
                timeout: 15000
            };
            const token = process.env.GITHUB_TOKEN;
            if (token) opts.headers['Authorization'] = `Bearer ${token}`;

            const req = https.get(opts, res => {
                if (res.statusCode === 403 || res.statusCode === 429) {
                    resolve({ message: 'rate limited', status: res.statusCode });
                    res.resume();
                    return;
                }
                if (res.statusCode >= 400) {
                    resolve({ message: `HTTP ${res.statusCode}`, status: res.statusCode });
                    res.resume();
                    return;
                }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }

    async healthCheck() {
        try {
            const data = await this._apiGet('/rate_limit');
            return { ok: true, remaining: data?.rate?.remaining };
        } catch {
            return { ok: false, reason: 'api unreachable' };
        }
    }
}
