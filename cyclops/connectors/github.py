import os
import aiohttp
from cyclops.connectors.base import BaseConnector


class GitHubConnector(BaseConnector):
    def __init__(self, config, state, telemetry):
        super().__init__(config, state, telemetry)
        self.name = "GitHub"
        self.token = os.environ.get("GITHUB_TOKEN")

    async def run(self, investigation_id, phase_id, input_type, input_value):
        run_id = self.state.record_connector_run(investigation_id, phase_id, self.name, input_type, input_value)
        self.telemetry.connector_start(investigation_id, self.name, phase_id, {"type": input_type, "value": input_value})

        try:
            headers = {"Accept": "application/vnd.github.v3+json"}
            if self.token:
                headers["Authorization"] = f"token {self.token}"

            entities = []
            async with aiohttp.ClientSession(headers=headers) as session:
                user = await self._get(session, f"https://api.github.com/users/{input_value}")
                if not user or "login" not in user:
                    self.state.complete_connector_run(run_id, "completed", 0)
                    self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "completed", "entitiesFound": 0, "input": {"type": input_type, "value": input_value}})
                    return {"status": "completed", "entities": [], "newCount": 0}

                entities.append({"type": "account", "data": {
                    "platform": "GitHub", "username": user["login"], "name": user.get("name"),
                    "bio": user.get("bio"), "location": user.get("location"), "company": user.get("company"),
                    "blog": user.get("blog"), "followers": user.get("followers"), "following": user.get("following"),
                    "public_repos": user.get("public_repos"), "created_at": user.get("created_at"), "avatar_url": user.get("avatar_url"),
                    "source": "github",
                }, "confidence": 0.95})

                if user.get("name"):
                    entities.append({"type": "person", "data": {"name": user["name"], "username": user["login"], "source": "github"}, "confidence": 0.9})
                if user.get("email"):
                    entities.append({"type": "email", "data": {"address": user["email"], "source": "github_profile"}, "confidence": 0.9,
                                     "as_known": {"type": "email", "value": user["email"]}})
                if user.get("blog"):
                    entities.append({"type": "url", "data": {"url": user["blog"], "source": "github_profile"}, "confidence": 0.8})
                if user.get("company"):
                    entities.append({"type": "organization", "data": {"name": user["company"].lstrip("@"), "source": "github"}, "confidence": 0.7})

                repos = await self._get(session, f"https://api.github.com/users/{input_value}/repos?per_page=30&sort=updated")
                for repo in (repos or []):
                    entities.append({"type": "repository", "data": {
                        "name": repo["full_name"], "description": repo.get("description"), "language": repo.get("language"),
                        "stars": repo.get("stargazers_count"), "url": repo.get("html_url"), "source": "github",
                    }, "confidence": 0.9})

                events = await self._get(session, f"https://api.github.com/users/{input_value}/events/public?per_page=30")
                seen_emails = set()
                for event in (events or []):
                    for commit in event.get("payload", {}).get("commits", []):
                        email = commit.get("author", {}).get("email", "")
                        if email and "@" in email and email not in seen_emails and "noreply" not in email:
                            seen_emails.add(email)
                            entities.append({"type": "email", "data": {"address": email, "source": "github_commits"}, "confidence": 0.85,
                                             "as_known": {"type": "email", "value": email}})

            new_count = 0
            for entity in entities:
                added = self.state.add_entity(investigation_id, entity["type"], entity["data"], entity.get("confidence", 0.5))
                if added["new"]:
                    new_count += 1
                self.telemetry.entity_discovered(investigation_id, entity["type"], added["new"], self.name)
                if "as_known" in entity:
                    self.state.add_known(investigation_id, entity["as_known"]["type"], entity["as_known"]["value"], self.name)

            self.state.complete_connector_run(run_id, "completed", new_count)
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "completed", "entitiesFound": new_count, "input": {"type": input_type, "value": input_value}})
            return {"status": "completed", "entities": entities, "newCount": new_count}
        except Exception as e:
            self.state.complete_connector_run(run_id, "failed", 0, error=str(e))
            self.telemetry.connector_end(investigation_id, self.name, phase_id, {"status": "failed", "input": {"type": input_type, "value": input_value}})
            return {"status": "failed", "error": str(e)}

    async def _get(self, session, url):
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 404:
                return None
            if resp.status == 403:
                return None
            if resp.status >= 400:
                return None
            return await resp.json()

    async def health_check(self):
        return {"ok": True, "hasApiKey": bool(self.token)}
