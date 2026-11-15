"""Short HTTP requests around long model calls; reconnects reuse the same job."""
import asyncio
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder


@dataclass
class Job:
    fingerprint: str
    created: float
    state: str = 'queued'
    result: Any = None
    status: int = 200
    detail: str | None = None
    task: asyncio.Task | None = None


class AiJobs:
    def __init__(self, ttl=900, capacity=32, concurrency=4):
        self.jobs: dict[str, Job] = {}
        self.ttl, self.capacity = ttl, capacity
        self.secret = secrets.token_bytes(32)
        self.slots = asyncio.Semaphore(concurrency)

    def cleanup(self):
        now = time.monotonic()
        self.jobs = {key: job for key, job in self.jobs.items()
                     if job.state in {'queued', 'running'} or now - job.created < self.ttl}

    def submit(self, identifier: str, operation: str, payload, handler: Callable):
        self.cleanup()
        # Only an HMAC survives after completion, never the submitted credentials.
        fingerprint = hmac.new(self.secret, json.dumps([operation, payload.model_dump()],
            sort_keys=True, ensure_ascii=False).encode(), hashlib.sha256).hexdigest()
        existing = self.jobs.get(identifier)
        if existing:
            if not hmac.compare_digest(existing.fingerprint, fingerprint):
                raise HTTPException(409, '请求标识已用于另一项任务')
            return self.snapshot(identifier)
        if len(self.jobs) >= self.capacity:
            # Keep running jobs; discard the oldest completed result if necessary.
            completed = [key for key, value in self.jobs.items() if value.state not in {'queued', 'running'}]
            if not completed:
                raise HTTPException(429, 'AI任务较多，请稍后重试')
            self.jobs.pop(completed[0])
        job = Job(fingerprint=fingerprint, created=time.monotonic())
        self.jobs[identifier] = job

        async def run():
            try:
                async with self.slots:
                    job.state = 'running'
                    job.result = jsonable_encoder(await asyncio.wait_for(handler(payload), timeout=180))
                    job.state = 'completed'
            except HTTPException as exc:
                job.state, job.status = 'failed', exc.status_code
                job.detail = exc.detail if isinstance(exc.detail, str) else 'AI请求参数无效'
            except asyncio.TimeoutError:
                job.state, job.status, job.detail = 'failed', 504, '模型响应超时，请重试'
            except asyncio.CancelledError:
                job.state, job.status, job.detail = 'failed', 499, '任务已取消'
                raise
            except Exception:
                job.state, job.status, job.detail = 'failed', 502, 'AI处理失败，请重试'
            finally:
                job.created = time.monotonic()
                job.task = None

        job.task = asyncio.create_task(run())
        return self.snapshot(identifier)

    def snapshot(self, identifier):
        self.cleanup()
        job = self.jobs.get(identifier)
        if not job:
            raise HTTPException(404, 'AI任务已过期或服务已重启，请重新发起')
        result = {'id': identifier, 'state': job.state}
        if job.state == 'completed':
            result['result'] = job.result
        if job.state == 'failed':
            result.update(status=job.status, detail=job.detail)
        return result

    def cancel(self, identifier):
        job = self.jobs.get(identifier)
        if job and job.task:
            job.task.cancel()
            job.state, job.status, job.detail = 'failed', 499, '任务已取消'
            job.created = time.monotonic()
        return {'ok': True}

    async def close(self):
        tasks = [job.task for job in self.jobs.values() if job.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


ai_jobs = AiJobs()
