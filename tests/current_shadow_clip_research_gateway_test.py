import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest


class FakeServer:
    def __init__(self, name):
        self.tools = {}

    def tool(self):
        def register(fn):
            self.tools[fn.__name__] = fn
            return fn
        return register


sdk = types.ModuleType('mcp.server.mcpserver')
sdk.MCPServer = FakeServer
sys.modules['mcp.server.mcpserver'] = sdk
script = Path(__file__).resolve().parents[1] / 'scripts' / 'current_shadow_gateway_v3.py'
spec = importlib.util.spec_from_file_location('clip_research_gateway_under_test', script)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class GatewayContractTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def http(method, route, payload=None):
            self.calls.append((method, route, payload))
            return {'ok': True}
        gateway._http = http
        gateway._practice_http = http
        self.context = {'assignmentId': 'assignment:1', 'claimedBy': 'controller', 'plans': [{'clipId': 'shot:1', 'planId': 'plan:1'}]}

    def test_fast_goal_envelope_retains_plan_context(self):
        goal = {'kind': 'SHORT_HORIZON', 'intents': [{'kind': 'transform'}]}
        gateway.mcp.tools['fast_ae_run'](json.dumps({'goal': goal, 'researchContext': self.context}))
        self.assertEqual(self.calls[0][2]['goal'], goal)
        self.assertEqual(self.calls[0][2]['researchContext'], self.context)

    def test_batch_envelope_and_legacy_batch_shape(self):
        intents = [{'kind': 'transform'}]
        gateway.mcp.tools['fast_ae_batch'](json.dumps({'intents': intents, 'researchContext': self.context}))
        self.assertEqual(self.calls[-1][2]['intents'], intents)
        self.assertEqual(self.calls[-1][2]['researchContext'], self.context)
        gateway.mcp.tools['fast_ae_batch'](json.dumps(intents))
        self.assertIsNone(self.calls[-1][2]['researchContext'])

    def test_apply_passes_existing_decision_json_context(self):
        gateway.mcp.tools['apply_edit_plan'](1, json.dumps([{'kind': 'transform'}]), decision_json=json.dumps({'researchContext': self.context}))
        self.assertEqual(self.calls[-1][2]['researchContext'], self.context)

    def test_research_tools_use_same_assignment_route(self):
        gateway.mcp.tools['record_clip_research']('assignment:1', json.dumps({'action': 'SCAN'}))
        self.assertEqual(self.calls[-1][1], '/v1/product/gpt/assignments/assignment%3A1/clip-research')
        self.assertEqual(self.calls[-1][2]['action'], 'SCAN')
        with self.assertRaises(ValueError):
            gateway.mcp.tools['record_clip_research']('assignment:1', '[]')


if __name__ == '__main__':
    unittest.main()
