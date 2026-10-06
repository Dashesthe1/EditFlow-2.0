import importlib.util
import io
import urllib.error
from unittest.mock import patch
import json
from pathlib import Path
import sys
import types
import unittest


class FakeServer:
    def __init__(self, name, **kwargs):
        self.tools = {}
        self.annotations = {}
        self.instructions = kwargs.get('instructions')

    def tool(self, **kwargs):
        def register(fn):
            self.tools[fn.__name__] = fn
            self.annotations[fn.__name__] = kwargs.get('annotations')
            return fn
        return register


class FakeToolError(Exception):
    pass


exceptions = types.ModuleType('mcp.server.mcpserver.exceptions')
exceptions.ToolError = FakeToolError
sys.modules['mcp.server.mcpserver.exceptions'] = exceptions
sdk = types.ModuleType('mcp.server.mcpserver')
sdk.MCPServer = FakeServer
sys.modules['mcp.server.mcpserver'] = sdk
script = Path(__file__).resolve().parents[1] / 'scripts' / 'current_shadow_gateway_v3.py'
spec = importlib.util.spec_from_file_location('clip_research_gateway_under_test', script)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


original_practice_http = gateway._practice_http


class GatewayContractTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def http(method, route, payload=None):
            self.calls.append((method, route, payload))
            if route.endswith('/production-jobs'):
                return {'job': {'jobId': 'job:1', 'status': 'COMPLETED', 'result': {'ok': True}}}
            return {'ok': True}
        gateway._http = http
        gateway._practice_http = http
        self.workflow = {'workflowId': 'CHATGPT_PRODUCTION_WORKFLOW_V1', 'planDecisionId': 'plan:1', 'planHash': 'hash:1', 'eventIds': ['shot:1']}
        self.context = {'assignmentId': 'assignment:1', 'claimedBy': 'controller', 'plans': [{'clipId': 'shot:1', 'planId': 'plan:1'}]}

    def test_fast_goal_envelope_retains_plan_context(self):
        goal = {'kind': 'SHORT_HORIZON', 'intents': [{'kind': 'transform'}]}
        gateway.mcp.tools['fast_ae_run'](json.dumps({'goal': goal, 'researchContext': self.context, 'workflowContext': self.workflow}))
        self.assertEqual(self.calls[0][2]['kind'], 'AE_GOAL')
        self.assertEqual(self.calls[0][2]['payload']['goal'], goal)
        self.assertEqual(self.calls[0][2]['payload']['researchContext'], self.context)
        self.assertEqual(self.calls[0][2]['payload']['workflowContext'], self.workflow)

    def test_batch_envelope_and_legacy_batch_shape(self):
        intents = [{'kind': 'transform'}]
        gateway.mcp.tools['fast_ae_batch'](json.dumps({'intents': intents, 'researchContext': self.context, 'workflowContext': self.workflow}))
        self.assertEqual(self.calls[-1][2]['payload']['intents'], intents)
        self.assertEqual(self.calls[-1][2]['payload']['researchContext'], self.context)
        self.assertEqual(self.calls[-1][2]['payload']['workflowContext'], self.workflow)
        with self.assertRaises(FakeToolError):
            gateway.mcp.tools['fast_ae_batch'](json.dumps(intents))

    def test_apply_passes_existing_decision_json_context(self):
        gateway.mcp.tools['apply_edit_plan'](1, json.dumps([{'kind': 'transform'}]), decision_json=json.dumps({'researchContext': self.context, 'workflowContext': self.workflow}))
        self.assertEqual(self.calls[-1][2]['payload']['researchContext'], self.context)
        self.assertEqual(self.calls[-1][2]['payload']['workflowContext'], self.workflow)

    def test_research_tools_use_same_assignment_route(self):
        gateway.mcp.tools['record_clip_research']('assignment:1', json.dumps({'action': 'SCAN'}))
        self.assertEqual(self.calls[-1][1], '/v1/product/gpt/assignments/assignment%3A1/clip-research')
        self.assertEqual(self.calls[-1][2]['action'], 'SCAN')
        with self.assertRaises(FakeToolError):
            gateway.mcp.tools['record_clip_research']('assignment:1', '[]')

    def test_direct_footage_tools_preserve_worker_and_requested_timestamps(self):
        gateway.mcp.tools['get_footage_selection']('assignment:1')
        self.assertEqual(self.calls[-1][:2], ('GET', '/v1/product/gpt/assignments/assignment%3A1/footage-selection'))
        payload = {'action': 'BROWSE', 'claimedBy': 'worker:current', 'mediaId': 'raw:1', 'timesMs': [1000, 2000]}
        gateway.mcp.tools['inspect_or_select_footage']('assignment:1', json.dumps(payload))
        self.assertEqual(self.calls[-1][2], payload)
        with self.assertRaises(FakeToolError):
            gateway.mcp.tools['inspect_or_select_footage']('assignment:1', '[]')
        for action in ('MATCH', 'RANK', 'AUTO_SELECT', 'ISOLATED_LEGACY_TEST'):
            with self.assertRaisesRegex(FakeToolError, 'Only direct ChatGPT'):
                gateway.mcp.tools['inspect_or_select_footage']('assignment:1', json.dumps({'action': action}))

    def test_chat_surface_advertises_one_footage_selection_method(self):
        surface = gateway.mcp.tools['get_mcp_surface']()
        self.assertEqual(surface['availableFootageSelectionMethods'], ['CHATGPT_DIRECT'])
        self.assertEqual(surface['rawShotCandidateRanking'], 'REMOVED_FROM_PRODUCTION')



class ConnectorReadinessTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def http(method, route, payload=None):
            self.calls.append((method, route, payload))
            if route == '/status':
                return {'productionSupervisor': {'assignmentId': 'assignment:1', 'generation': 90, 'state': 'PAUSED'}}
            if route.endswith('/production-jobs'):
                return {'jobs': [], 'writerOwner': None}
            if route.endswith('/production'):
                return {'production': {'stage': 'LOCAL_PROOF'}}
            return {'ok': True}
        gateway._http = http
        gateway._practice_http = http
        self.credential = 'ef-worker:90:isolated-test'
        self.client_names = list(gateway.mcp.tools)

    def test_advertisement_matches_registered_tools(self):
        surface = gateway.mcp.tools['get_mcp_surface']()
        self.assertEqual(set(surface['tools']), set(gateway.mcp.tools))
        self.assertTrue(set(gateway.REQUIRED_PRODUCTION_TOOLS).issubset(surface['tools']))
        self.assertEqual(surface['connectorPreflight']['status'], 'CLIENT_UNVERIFIED')
        self.assertEqual(surface['connectorPreflight']['writeAuthorization'], 'NOT_TESTED')

    def test_missing_client_queue_tools_block_even_when_server_has_them(self):
        names = [name for name in self.client_names if name != 'enqueue_production_job']
        result = gateway.mcp.tools['get_mcp_surface']('assignment:1', json.dumps(names))['connectorPreflight']
        self.assertEqual(result['status'], 'BLOCKED_MISSING_TOOLS')
        self.assertEqual(result['missingTools'], ['enqueue_production_job'])
        self.assertTrue(result['requiresClientRefresh'])
        self.assertFalse(result['jobsReadVerified'])
        self.assertTrue(all(method == 'GET' for method, _, _ in self.calls))

    def test_complete_client_verifies_actual_queue_and_production_reads_without_resume(self):
        names = ['mcp__codex_apps__editflow___current_shadow__editflow_current_shadow_' + name for name in self.client_names]
        result = gateway.mcp.tools['get_mcp_surface']('assignment:1', json.dumps(names))['connectorPreflight']
        self.assertEqual(result['status'], 'READY')
        self.assertTrue(result['jobsReadVerified'])
        self.assertTrue(result['productionReadVerified'])
        self.assertEqual(result['authorityState'], 'PAUSED')
        self.assertEqual(result['generation'], 90)
        self.assertEqual(result['writeAuthorization'], 'NOT_TESTED')
        self.assertEqual(result['inFlightJobs'], 0)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.calls))
        self.assertIn(('GET', '/v1/product/gpt/assignments/assignment%3A1/production-jobs', None), self.calls)
        self.assertIn(('GET', '/v1/product/gpt/assignments/assignment%3A1/production', None), self.calls)

    def test_incomplete_or_failed_read_cannot_claim_ready(self):
        def fail(method, route, payload=None):
            if route.endswith('/production-jobs'):
                raise RuntimeError('read temporarily unavailable')
            return {'production': {}}
        gateway._practice_http = fail
        result = gateway.mcp.tools['get_mcp_surface']('assignment:1', json.dumps(self.client_names))['connectorPreflight']
        self.assertEqual(result['status'], 'BLOCKED_PRODUCTION_READ')
        self.assertFalse(result['jobsReadVerified'])

    def test_wrong_assignment_does_not_read_or_rebind_production(self):
        result = gateway.mcp.tools['get_mcp_surface']('assignment:other', json.dumps(self.client_names))['connectorPreflight']
        self.assertEqual(result['status'], 'BLOCKED_ASSIGNMENT_MISMATCH')
        self.assertFalse(any('/assignments/' in route for _, route, _ in self.calls))

    def test_update_forwards_exact_worker_and_decision_without_ae_or_lifecycle_routes(self):
        payload = {'claimedBy': self.credential, 'action': 'HEARTBEAT', 'operation': 'GPT_RESEARCH:shot10'}
        gateway.mcp.tools['record_production_update']('assignment:1', json.dumps(payload))
        self.assertEqual(self.calls, [('POST', '/v1/product/gpt/assignments/assignment%3A1/production', payload)])
        for action in ['PAUSE', 'RESUME', 'ISSUE', 'REVOKE', 'REPLACE_CHAT', 'AE_CORRECTION']:
            with self.subTest(action=action):
                with self.assertRaises(FakeToolError):
                    gateway.mcp.tools['record_production_update']('assignment:1', json.dumps({'claimedBy': self.credential, 'action': action}))
        self.assertEqual(len(self.calls), 1)

    def test_missing_worker_never_creates_implicit_identity_or_reaches_api(self):
        attempts = [
            lambda: gateway.mcp.tools['claim_gpt_assignment']('assignment:1'),
            lambda: gateway.mcp.tools['record_production_update']('assignment:1', '{"action":"HEARTBEAT"}'),
            lambda: gateway.mcp.tools['record_gpt_learning_event']('assignment:1', 'REVIEW', 'observation'),
            lambda: gateway.mcp.tools['fail_gpt_assignment']('assignment:1', 'error'),
            lambda: gateway.mcp.tools['acknowledge_gpt_assignment_cancelled']('assignment:1'),
            lambda: gateway.mcp.tools['complete_gpt_assignment']('assignment:1', True, 'done'),
            lambda: gateway.mcp.tools['enqueue_production_job']('assignment:1', '{"kind":"AE_CORRECTION","payload":{"researchContext":{"assignmentId":"assignment:1"}}}'),
            lambda: gateway.mcp.tools['resolve_production_job']('assignment:1', 'job:1', '', 'evidence:1'),
        ]
        for attempt in attempts:
            with self.assertRaises(FakeToolError):
                attempt()
        self.assertEqual(self.calls, [])

    def test_stale_worker_response_propagates_without_retry_or_fallback(self):
        attempts = []
        def reject(method, route, payload=None):
            attempts.append((method, route, payload))
            raise gateway.BridgeRequestError('Practice bridge', 409, '{"error":"STALE_WORKER"}')
        gateway._practice_http = reject
        with self.assertRaisesRegex(FakeToolError, 'HTTP 409: STALE_WORKER'):
            gateway.mcp.tools['record_production_update']('assignment:1', json.dumps({'claimedBy': self.credential, 'action': 'HEARTBEAT'}))
        self.assertEqual(len(attempts), 1)
        self.assertTrue(attempts[0][1].endswith('/production'))

    def test_learning_and_failure_acknowledgement_preserve_explicit_worker(self):
        gateway.mcp.tools['record_gpt_learning_event']('assignment:1', 'REVIEW', 'observed', claimed_by=self.credential)
        gateway.mcp.tools['fail_gpt_assignment']('assignment:1', 'isolated failure', claimed_by=self.credential)
        gateway.mcp.tools['acknowledge_gpt_assignment_cancelled']('assignment:1', claimed_by=self.credential)
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all(payload['claimedBy'] == self.credential for _, _, payload in self.calls))

    def test_queue_preserves_workflow_decision_and_worker_and_rejects_wrong_assignment(self):
        payload = {'kind': 'AE_CORRECTION', 'payload': {
            'researchContext': {'assignmentId': 'assignment:1', 'claimedBy': self.credential},
            'workflowContext': {'workflowId': 'CHATGPT_PRODUCTION_WORKFLOW_V1', 'planDecisionId': 'plan:1'},
            'editorialDecision': {'authority': 'CHATGPT_DIRECT', 'decisionId': 'decision:1'}}}
        gateway.mcp.tools['enqueue_production_job']('assignment:1', json.dumps(payload))
        self.assertEqual(self.calls[0][2], payload)
        with self.assertRaises(FakeToolError):
            gateway.mcp.tools['enqueue_production_job']('assignment:other', json.dumps(payload))
        self.assertEqual(len(self.calls), 1)

    def test_read_write_annotations_are_honest_and_bound_to_local_editflow(self):
        for name in ['get_mcp_surface', 'get_production_state', 'get_production_jobs']:
            annotations = gateway.mcp.annotations[name]
            self.assertTrue(annotations['readOnlyHint'])
            self.assertFalse(annotations['destructiveHint'])
            self.assertFalse(annotations['openWorldHint'])
        for name in ['enqueue_production_job', 'resolve_production_job', 'record_production_update']:
            annotations = gateway.mcp.annotations[name]
            self.assertFalse(annotations['readOnlyHint'])
            self.assertTrue(annotations['destructiveHint'])
            self.assertFalse(annotations['openWorldHint'])


class BackendErrorTests(unittest.TestCase):
    def test_transport_rejection_keeps_status_reason_and_redacts_worker(self):
        worker = 'ef-worker:93:' + 'a' * 64
        body = json.dumps({'error': 'STALE_WORKER: retired owner ' + worker}).encode()
        failure = urllib.error.HTTPError('http://127.0.0.1/production', 409, 'Conflict', {}, io.BytesIO(body))
        # Contract test classes replace these helpers, so use their saved originals.
        with patch.object(gateway, '_practice_config', return_value=('http://127.0.0.1', 'local-token')), \
             patch.object(gateway.urllib.request, 'urlopen', side_effect=failure) as request:
            with self.assertRaisesRegex(gateway.BridgeRequestError, 'HTTP 409: STALE_WORKER') as caught:
                original_practice_http('POST', '/production', {'claimedBy': worker})
        self.assertNotIn(worker, str(caught.exception))
        self.assertIn('ef-worker:93:REDACTED', str(caught.exception))
        self.assertEqual(request.call_count, 1)

    def test_tool_error_includes_action_without_hiding_request_validation(self):
        worker = 'ef-worker:93:' + 'b' * 64
        calls = []
        def reject(method, route, payload=None):
            calls.append((method, route))
            raise gateway.BridgeRequestError('Practice bridge', 400, '{"error":"Workflow review requires issued render inspections."}')
        with patch.object(gateway, '_practice_http', reject):
            with self.assertRaisesRegex(FakeToolError, 'WORKFLOW_REVIEW.*HTTP 400: Workflow review requires issued') as caught:
                gateway.mcp.tools['record_production_update'](
                    assignment_id='assignment:1',
                    update_json=json.dumps({'claimedBy': worker, 'action': 'WORKFLOW_REVIEW', 'review': {}}))
        self.assertEqual(len(calls), 1)
        self.assertNotIn(worker, str(caught.exception))

    def test_sensitive_header_values_are_redacted(self):
        reason = gateway._safe_error_text('X-EditFlow-Token: secret-token Authorization: Bearer-secret')
        self.assertNotIn('secret-token', reason)
        self.assertNotIn('Bearer-secret', reason)


if __name__ == '__main__':
    unittest.main()