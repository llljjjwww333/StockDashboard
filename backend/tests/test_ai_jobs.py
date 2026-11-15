import asyncio
import unittest
from unittest.mock import AsyncMock

from fastapi import HTTPException
from app.schemas.analysis import ProviderConfig, ProviderTestRequest
from app.services.ai_jobs import AiJobs


def payload(model='fixture'):
    return ProviderTestRequest(settings=ProviderConfig(base_url='https://example.com', model=model, api_key='fixture-only-key'))


class AiJobTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.jobs = AiJobs()

    async def asyncTearDown(self):
        await self.jobs.close()

    async def test_lost_submit_response_can_be_retried_without_second_model_call(self):
        release = asyncio.Event()
        started = asyncio.Event()
        calls = []
        async def handler(request):
            calls.append(request.settings.model)
            started.set()
            await release.wait()
            return {'ok': True}
        self.jobs.submit('job', 'test', payload(), handler)
        await asyncio.wait_for(started.wait(), 1)
        self.jobs.submit('job', 'test', payload(), handler)
        self.assertEqual(calls, ['fixture'])
        release.set()
        await self.jobs.jobs['job'].task
        self.assertEqual(self.jobs.snapshot('job')['result'], {'ok': True})
        self.assertNotIn('fixture-only-key', repr(self.jobs.jobs['job']))
        self.assertIsNone(self.jobs.jobs['job'].task)
        self.jobs.submit('job', 'test', payload(), handler)
        self.assertEqual(calls, ['fixture'])

    async def test_conflicting_request_is_rejected_and_upstream_failure_is_final(self):
        handler = AsyncMock(side_effect=HTTPException(502, 'API Key 无效'))
        self.jobs.submit('job', 'test', payload(), handler)
        with self.assertRaises(HTTPException) as conflict:
            self.jobs.submit('job', 'test', payload('different'), handler)
        self.assertEqual(conflict.exception.status_code, 409)
        await self.jobs.jobs['job'].task
        self.assertEqual(self.jobs.snapshot('job')['state'], 'failed')
        self.assertEqual(self.jobs.snapshot('job')['detail'], 'API Key 无效')
        self.assertEqual(handler.call_count, 1)

    async def test_cancel_before_task_starts_does_not_leave_a_permanent_queued_job(self):
        handler = AsyncMock()
        self.jobs.submit('job', 'test', payload(), handler)
        self.jobs.cancel('job')
        await asyncio.sleep(0)
        self.assertEqual(self.jobs.snapshot('job')['state'], 'failed')
        handler.assert_not_called()

    async def test_capacity_and_expiry_keep_active_work(self):
        self.jobs = AiJobs(ttl=900, capacity=1)
        release = asyncio.Event()
        async def handler(_):
            await release.wait()
            return {'ok': True}
        self.jobs.submit('job', 'test', payload(), handler)
        self.jobs.jobs['job'].created -= 901
        await asyncio.sleep(0)
        with self.assertRaises(HTTPException) as full:
            self.jobs.submit('other', 'test', payload(), handler)
        self.assertEqual(full.exception.status_code, 429)
        self.assertEqual(self.jobs.snapshot('job')['state'], 'running')
        release.set()
        await self.jobs.jobs['job'].task
        self.jobs.jobs['job'].created -= 901
        with self.assertRaises(HTTPException) as missing:
            self.jobs.snapshot('job')
        self.assertEqual(missing.exception.status_code, 404)
