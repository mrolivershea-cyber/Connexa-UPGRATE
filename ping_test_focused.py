#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class PingTestFocused:
    def __init__(self, base_url="https://cleaner-admin-ui.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.headers = {'Content-Type': 'application/json'}

    def make_request(self, method: str, endpoint: str, data: dict = None, expected_status: int = 200) -> tuple:
        """Make HTTP request and return success status and response"""
        url = f"{self.api_url}/{endpoint}"
        headers = self.headers.copy()
        
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=data)
            elif method == 'POST':
                response = requests.post(url, headers=headers, json=data)
            else:
                return False, {"error": f"Unsupported method: {method}"}

            success = response.status_code == expected_status
            try:
                response_data = response.json()
            except:
                response_data = {"text": response.text, "status_code": response.status_code}

            return success, response_data

        except Exception as e:
            return False, {"error": str(e)}

    def login(self):
        """Login with admin credentials"""
        login_data = {
            "username": "admin",
            "password": "admin"
        }
        
        success, response = self.make_request('POST', 'auth/login', login_data)
        
        if success and 'access_token' in response:
            self.token = response['access_token']
            print("✅ Login successful")
            return True
        else:
            print(f"❌ Login failed: {response}")
            return False

    def test_ping_test_status_restriction_removal(self):
        """CRITICAL TEST: Ping test status restriction removal (Review Request)"""
        print("\n🔥 CRITICAL TEST: Ping Test Status Restriction Removal")
        print("=" * 60)
        
        # Get current database state
        stats_success, stats_response = self.make_request('GET', 'stats')
        if not stats_success:
            print(f"❌ Failed to get stats: {stats_response}")
            return False
        
        print(f"📊 Current Database State:")
        print(f"   Total nodes: {stats_response.get('total', 0)}")
        print(f"   Not tested: {stats_response.get('not_tested', 0)}")
        print(f"   Ping failed: {stats_response.get('ping_failed', 0)}")
        print(f"   Ping OK: {stats_response.get('ping_ok', 0)}")
        
        # Test Scenario 1: Node with 'not_tested' status (ID 6, IP: 11.152.113.213)
        print(f"\n🧪 Test Scenario 1: not_tested node (ID 6, IP: 11.152.113.213)")
        test_data_1 = {"node_ids": [6]}
        success_1, response_1 = self.make_request('POST', 'manual/ping-test', test_data_1)
        
        scenario_1_passed = False
        if success_1 and 'results' in response_1 and response_1['results']:
            result = response_1['results'][0]
            print(f"   Response: {result}")
            if (result.get('success') and 
                'original_status' in result and
                result.get('status') in ['ping_ok', 'ping_failed'] and
                '->' in result.get('message', '')):
                scenario_1_passed = True
                print(f"   ✅ SUCCESS: {result.get('message', 'No message')}")
            else:
                print(f"   ❌ FAILED: Expected original_status tracking and status transition, got: {result}")
        else:
            print(f"   ❌ FAILED: API call failed: {response_1}")
        
        # Test Scenario 2: Node with 'ping_failed' status (ID 1, IP: 50.48.85.55)
        print(f"\n🧪 Test Scenario 2: ping_failed node (ID 1, IP: 50.48.85.55)")
        test_data_2 = {"node_ids": [1]}
        success_2, response_2 = self.make_request('POST', 'manual/ping-test', test_data_2)
        
        scenario_2_passed = False
        if success_2 and 'results' in response_2 and response_2['results']:
            result = response_2['results'][0]
            print(f"   Response: {result}")
            if (result.get('success') and 
                'original_status' in result and
                result.get('status') in ['ping_ok', 'ping_failed'] and
                '->' in result.get('message', '')):
                scenario_2_passed = True
                print(f"   ✅ SUCCESS: {result.get('message', 'No message')}")
            else:
                print(f"   ❌ FAILED: Expected original_status tracking and status transition, got: {result}")
        else:
            print(f"   ❌ FAILED: API call failed: {response_2}")
        
        # Test Scenario 3: Node with 'ping_ok' status (ID 2337, IP: 72.197.30.147)
        print(f"\n🧪 Test Scenario 3: ping_ok node (ID 2337, IP: 72.197.30.147)")
        test_data_3 = {"node_ids": [2337]}
        success_3, response_3 = self.make_request('POST', 'manual/ping-test', test_data_3)
        
        scenario_3_passed = False
        if success_3 and 'results' in response_3 and response_3['results']:
            result = response_3['results'][0]
            print(f"   Response: {result}")
            if (result.get('success') and 
                'original_status' in result and
                result.get('status') in ['ping_ok', 'ping_failed'] and
                '->' in result.get('message', '')):
                scenario_3_passed = True
                print(f"   ✅ SUCCESS: {result.get('message', 'No message')}")
            else:
                print(f"   ❌ FAILED: Expected original_status tracking and status transition, got: {result}")
        else:
            print(f"   ❌ FAILED: API call failed: {response_3}")
        
        # Test Scenario 4: Multiple nodes with different statuses
        print(f"\n🧪 Test Scenario 4: Multiple nodes with different statuses")
        test_data_4 = {"node_ids": [6, 1, 2337]}
        success_4, response_4 = self.make_request('POST', 'manual/ping-test', test_data_4)
        
        scenario_4_passed = False
        if success_4 and 'results' in response_4 and len(response_4['results']) == 3:
            all_accepted = True
            for result in response_4['results']:
                if not result.get('success') or 'original_status' not in result:
                    all_accepted = False
                    break
                print(f"   Node {result.get('node_id')}: {result.get('message', 'No message')}")
            
            if all_accepted:
                scenario_4_passed = True
                print(f"   ✅ SUCCESS: All 3 nodes accepted regardless of status")
            else:
                print(f"   ❌ FAILED: Not all nodes were accepted")
        else:
            print(f"   ❌ FAILED: Expected 3 results, got: {len(response_4.get('results', []))}")
        
        # Overall test result
        all_scenarios_passed = scenario_1_passed and scenario_2_passed and scenario_3_passed and scenario_4_passed
        
        print(f"\n📊 FINAL RESULTS:")
        print(f"   Scenario 1 (not_tested): {'✅ PASSED' if scenario_1_passed else '❌ FAILED'}")
        print(f"   Scenario 2 (ping_failed): {'✅ PASSED' if scenario_2_passed else '❌ FAILED'}")
        print(f"   Scenario 3 (ping_ok): {'✅ PASSED' if scenario_3_passed else '❌ FAILED'}")
        print(f"   Scenario 4 (multiple): {'✅ PASSED' if scenario_4_passed else '❌ FAILED'}")
        
        if all_scenarios_passed:
            print(f"\n🎉 CRITICAL TEST PASSED: Status restriction removed, original_status tracking working, status transitions shown in messages")
            return True
        else:
            failed_scenarios = []
            if not scenario_1_passed: failed_scenarios.append("not_tested node")
            if not scenario_2_passed: failed_scenarios.append("ping_failed node")
            if not scenario_3_passed: failed_scenarios.append("ping_ok node")
            if not scenario_4_passed: failed_scenarios.append("multiple nodes")
            
            print(f"\n❌ CRITICAL TEST FAILED: {', '.join(failed_scenarios)}")
            return False

def main():
    tester = PingTestFocused()
    
    if not tester.login():
        sys.exit(1)
    
    success = tester.test_ping_test_status_restriction_removal()
    
    if success:
        print("\n✅ All tests passed!")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()