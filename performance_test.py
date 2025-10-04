#!/usr/bin/env python3

import requests
import sys
import json
import time
import threading
import queue
from datetime import datetime
from typing import Dict, Any, List

class PerformanceTester:
    def __init__(self, base_url="https://fastnode-admin.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.headers = {'Content-Type': 'application/json'}
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}: PASSED")
        else:
            print(f"❌ {name}: FAILED - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details,
            "response_data": response_data
        })

    def make_request(self, method: str, endpoint: str, data: Dict = None, expected_status: int = 200) -> tuple:
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
            elif method == 'PUT':
                response = requests.put(url, headers=headers, json=data)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, json=data)
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

    def test_login(self):
        """Test login with admin credentials"""
        login_data = {
            "username": "admin",
            "password": "admin"
        }
        
        success, response = self.make_request('POST', 'auth/login', login_data)
        
        if success and 'access_token' in response:
            self.token = response['access_token']
            self.log_test("Admin Login", True)
            return True
        else:
            self.log_test("Admin Login", False, f"Login failed: {response}")
            return False

    def test_logout(self):
        """Test logout functionality"""
        success, response = self.make_request('POST', 'auth/logout')
        
        if success:
            self.log_test("Logout", True, "Logged out successfully")
            return True
        else:
            self.log_test("Logout", False, f"Failed to logout: {response}")
            return False

    def test_performance_api_nodes_filters(self):
        """Test GET /api/nodes with various filters - should be < 200ms"""
        print("\n🚀 PERFORMANCE TEST: GET /api/nodes with filters")
        print("=" * 60)
        
        filter_combinations = [
            {"ip": "192.168"},
            {"provider": "CloudVPN"},
            {"country": "United States"},
            {"state": "California"},
            {"city": "Los Angeles"},
            {"status": "not_tested"},
            {"protocol": "pptp"},
            {"ip": "10.0", "status": "not_tested"},
            {"provider": "VPN", "country": "United States"},
            {"state": "California", "city": "Los Angeles"},
            {"country": "United States", "status": "not_tested", "protocol": "pptp"}
        ]
        
        performance_results = []
        
        for i, filters in enumerate(filter_combinations, 1):
            start_time = time.time()
            success, response = self.make_request('GET', 'nodes', filters)
            end_time = time.time()
            
            response_time_ms = (end_time - start_time) * 1000
            
            if success and 'nodes' in response:
                total_nodes = response.get('total', 0)
                returned_nodes = len(response['nodes'])
                
                performance_results.append({
                    'test': f"Filter Test {i}",
                    'filters': filters,
                    'response_time_ms': response_time_ms,
                    'total_nodes': total_nodes,
                    'returned_nodes': returned_nodes,
                    'passed': response_time_ms < 200
                })
                
                status = "✅ PASS" if response_time_ms < 200 else "❌ FAIL"
                print(f"   {status} Filter {i}: {response_time_ms:.1f}ms (< 200ms target) - {total_nodes} total, {returned_nodes} returned")
                print(f"      Filters: {filters}")
            else:
                performance_results.append({
                    'test': f"Filter Test {i}",
                    'filters': filters,
                    'response_time_ms': response_time_ms,
                    'total_nodes': 0,
                    'returned_nodes': 0,
                    'passed': False
                })
                print(f"   ❌ FAIL Filter {i}: Request failed - {response}")
        
        # Calculate overall performance
        passed_tests = sum(1 for r in performance_results if r['passed'])
        avg_response_time = sum(r['response_time_ms'] for r in performance_results) / len(performance_results)
        max_response_time = max(r['response_time_ms'] for r in performance_results)
        
        print(f"\n📊 PERFORMANCE SUMMARY:")
        print(f"   Tests Passed: {passed_tests}/{len(performance_results)}")
        print(f"   Average Response Time: {avg_response_time:.1f}ms")
        print(f"   Max Response Time: {max_response_time:.1f}ms")
        print(f"   Target: < 200ms")
        
        overall_success = passed_tests == len(performance_results) and avg_response_time < 200
        
        self.log_test("Performance - API Nodes Filters", overall_success,
                     f"{passed_tests}/{len(performance_results)} filters < 200ms, avg: {avg_response_time:.1f}ms")
        
        return overall_success

    def test_performance_nodes_all_ids(self):
        """Test GET /api/nodes/all-ids endpoint performance - should be < 500ms"""
        print("\n🚀 PERFORMANCE TEST: GET /api/nodes/all-ids")
        print("=" * 60)
        
        filter_combinations = [
            {},  # No filters - get all IDs
            {"status": "not_tested"},
            {"protocol": "pptp"},
            {"country": "United States"},
            {"state": "California"},
            {"provider": "VPN"},
            {"status": "not_tested", "protocol": "pptp"},
            {"country": "United States", "state": "California"}
        ]
        
        performance_results = []
        
        for i, filters in enumerate(filter_combinations, 1):
            start_time = time.time()
            success, response = self.make_request('GET', 'nodes/all-ids', filters)
            end_time = time.time()
            
            response_time_ms = (end_time - start_time) * 1000
            
            if success and 'node_ids' in response:
                total_ids = response.get('total_count', 0)
                
                performance_results.append({
                    'test': f"All-IDs Test {i}",
                    'filters': filters,
                    'response_time_ms': response_time_ms,
                    'total_ids': total_ids,
                    'passed': response_time_ms < 500
                })
                
                status = "✅ PASS" if response_time_ms < 500 else "❌ FAIL"
                print(f"   {status} All-IDs {i}: {response_time_ms:.1f}ms (< 500ms target) - {total_ids} IDs")
                print(f"      Filters: {filters}")
            else:
                performance_results.append({
                    'test': f"All-IDs Test {i}",
                    'filters': filters,
                    'response_time_ms': response_time_ms,
                    'total_ids': 0,
                    'passed': False
                })
                print(f"   ❌ FAIL All-IDs {i}: Request failed - {response}")
        
        # Calculate overall performance
        passed_tests = sum(1 for r in performance_results if r['passed'])
        avg_response_time = sum(r['response_time_ms'] for r in performance_results) / len(performance_results)
        max_response_time = max(r['response_time_ms'] for r in performance_results)
        
        print(f"\n📊 PERFORMANCE SUMMARY:")
        print(f"   Tests Passed: {passed_tests}/{len(performance_results)}")
        print(f"   Average Response Time: {avg_response_time:.1f}ms")
        print(f"   Max Response Time: {max_response_time:.1f}ms")
        print(f"   Target: < 500ms")
        
        overall_success = passed_tests == len(performance_results) and avg_response_time < 500
        
        self.log_test("Performance - Nodes All-IDs", overall_success,
                     f"{passed_tests}/{len(performance_results)} requests < 500ms, avg: {avg_response_time:.1f}ms")
        
        return overall_success

    def test_performance_stats_api(self):
        """Test GET /api/stats endpoint performance - should be < 1000ms"""
        print("\n🚀 PERFORMANCE TEST: GET /api/stats")
        print("=" * 60)
        
        # Test stats endpoint multiple times to get consistent results
        response_times = []
        
        for i in range(5):
            start_time = time.time()
            success, response = self.make_request('GET', 'stats')
            end_time = time.time()
            
            response_time_ms = (end_time - start_time) * 1000
            response_times.append(response_time_ms)
            
            if success and 'total' in response:
                status = "✅ PASS" if response_time_ms < 1000 else "❌ FAIL"
                print(f"   {status} Stats Test {i+1}: {response_time_ms:.1f}ms (< 1000ms target)")
                print(f"      Total nodes: {response.get('total', 0)}")
                print(f"      Status breakdown: not_tested={response.get('not_tested', 0)}, online={response.get('online', 0)}")
            else:
                print(f"   ❌ FAIL Stats Test {i+1}: Request failed - {response}")
                response_times[-1] = 9999  # Mark as failed
        
        # Calculate performance metrics
        valid_times = [t for t in response_times if t < 9999]
        if valid_times:
            avg_response_time = sum(valid_times) / len(valid_times)
            max_response_time = max(valid_times)
            min_response_time = min(valid_times)
            passed_tests = sum(1 for t in valid_times if t < 1000)
            
            print(f"\n📊 PERFORMANCE SUMMARY:")
            print(f"   Tests Passed: {passed_tests}/{len(valid_times)}")
            print(f"   Average Response Time: {avg_response_time:.1f}ms")
            print(f"   Min Response Time: {min_response_time:.1f}ms")
            print(f"   Max Response Time: {max_response_time:.1f}ms")
            print(f"   Target: < 1000ms")
            
            overall_success = passed_tests == len(valid_times) and avg_response_time < 1000
            
            self.log_test("Performance - Stats API", overall_success,
                         f"{passed_tests}/{len(valid_times)} requests < 1000ms, avg: {avg_response_time:.1f}ms")
            
            return overall_success
        else:
            self.log_test("Performance - Stats API", False, "All stats requests failed")
            return False

    def test_performance_concurrent_requests(self):
        """Test concurrent API requests to verify no performance degradation"""
        print("\n🚀 PERFORMANCE TEST: Concurrent API Requests")
        print("=" * 60)
        
        # Test concurrent requests to different endpoints
        endpoints_to_test = [
            ('GET', 'nodes', {'limit': 50}),
            ('GET', 'stats', {}),
            ('GET', 'nodes/all-ids', {'status': 'not_tested'}),
            ('GET', 'nodes', {'protocol': 'pptp', 'limit': 50}),
            ('GET', 'autocomplete/countries', {})
        ]
        
        results_queue = queue.Queue()
        
        def make_concurrent_request(endpoint_data, thread_id):
            method, endpoint, params = endpoint_data
            start_time = time.time()
            success, response = self.make_request(method, endpoint, params)
            end_time = time.time()
            
            response_time_ms = (end_time - start_time) * 1000
            
            results_queue.put({
                'thread_id': thread_id,
                'endpoint': endpoint,
                'method': method,
                'success': success,
                'response_time_ms': response_time_ms,
                'response': response
            })
        
        # Start concurrent requests
        threads = []
        start_time = time.time()
        
        for i, endpoint_data in enumerate(endpoints_to_test):
            thread = threading.Thread(target=make_concurrent_request, args=(endpoint_data, i+1))
            threads.append(thread)
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        total_time = (time.time() - start_time) * 1000
        
        # Collect results
        results = []
        while not results_queue.empty():
            results.append(results_queue.get())
        
        # Analyze results
        successful_requests = [r for r in results if r['success']]
        failed_requests = [r for r in results if not r['success']]
        
        if successful_requests:
            avg_response_time = sum(r['response_time_ms'] for r in successful_requests) / len(successful_requests)
            max_response_time = max(r['response_time_ms'] for r in successful_requests)
            
            print(f"📊 CONCURRENT REQUEST RESULTS:")
            print(f"   Total Requests: {len(results)}")
            print(f"   Successful: {len(successful_requests)}")
            print(f"   Failed: {len(failed_requests)}")
            print(f"   Total Time: {total_time:.1f}ms")
            print(f"   Average Response Time: {avg_response_time:.1f}ms")
            print(f"   Max Response Time: {max_response_time:.1f}ms")
            
            for result in successful_requests:
                status = "✅" if result['response_time_ms'] < 2000 else "⚠️"
                print(f"   {status} Thread {result['thread_id']} ({result['endpoint']}): {result['response_time_ms']:.1f}ms")
            
            for result in failed_requests:
                print(f"   ❌ Thread {result['thread_id']} ({result['endpoint']}): FAILED")
            
            # Success criteria: all requests successful, no request > 2000ms, avg < 1000ms
            overall_success = (len(failed_requests) == 0 and 
                             max_response_time < 2000 and 
                             avg_response_time < 1000)
            
            self.log_test("Performance - Concurrent Requests", overall_success,
                         f"{len(successful_requests)}/{len(results)} successful, avg: {avg_response_time:.1f}ms, max: {max_response_time:.1f}ms")
            
            return overall_success
        else:
            self.log_test("Performance - Concurrent Requests", False, "All concurrent requests failed")
            return False

    def test_performance_database_indexes(self):
        """Test database index effectiveness by comparing filtered vs unfiltered queries"""
        print("\n🚀 PERFORMANCE TEST: Database Index Verification")
        print("=" * 60)
        
        # Test queries that should benefit from indexes
        indexed_queries = [
            {"filter": {"provider": "CloudVPN"}, "description": "Provider index"},
            {"filter": {"country": "United States"}, "description": "Country index"},
            {"filter": {"state": "California"}, "description": "State index"},
            {"filter": {"city": "Los Angeles"}, "description": "City index"},
            {"filter": {"status": "not_tested"}, "description": "Status index"},
            {"filter": {"protocol": "pptp"}, "description": "Protocol index"},
            {"filter": {"zipcode": "90210"}, "description": "Zipcode index"},
            {"filter": {"login": "admin"}, "description": "Login index"}
        ]
        
        performance_results = []
        
        # First, get baseline performance with no filters
        start_time = time.time()
        success, baseline_response = self.make_request('GET', 'nodes', {'limit': 200})
        baseline_time = (time.time() - start_time) * 1000
        
        if success:
            baseline_total = baseline_response.get('total', 0)
            print(f"📊 Baseline (no filters): {baseline_time:.1f}ms - {baseline_total} total nodes")
        else:
            print(f"❌ Baseline query failed: {baseline_response}")
            self.log_test("Performance - Database Indexes", False, "Baseline query failed")
            return False
        
        # Test each indexed query
        for query_data in indexed_queries:
            filters = query_data["filter"]
            description = query_data["description"]
            
            start_time = time.time()
            success, response = self.make_request('GET', 'nodes', filters)
            response_time = (time.time() - start_time) * 1000
            
            if success and 'nodes' in response:
                total_nodes = response.get('total', 0)
                returned_nodes = len(response['nodes'])
                
                # Index is effective if filtered query is not significantly slower than baseline
                # Allow up to 3x baseline time for complex filters
                index_effective = response_time <= (baseline_time * 3)
                
                performance_results.append({
                    'description': description,
                    'filters': filters,
                    'response_time_ms': response_time,
                    'total_nodes': total_nodes,
                    'returned_nodes': returned_nodes,
                    'index_effective': index_effective
                })
                
                status = "✅ EFFECTIVE" if index_effective else "⚠️ SLOW"
                print(f"   {status} {description}: {response_time:.1f}ms - {total_nodes} total, {returned_nodes} returned")
                print(f"      Filter: {filters}")
            else:
                performance_results.append({
                    'description': description,
                    'filters': filters,
                    'response_time_ms': 9999,
                    'total_nodes': 0,
                    'returned_nodes': 0,
                    'index_effective': False
                })
                print(f"   ❌ FAILED {description}: Request failed - {response}")
        
        # Calculate overall index effectiveness
        effective_indexes = sum(1 for r in performance_results if r['index_effective'])
        avg_response_time = sum(r['response_time_ms'] for r in performance_results if r['response_time_ms'] < 9999)
        if performance_results:
            avg_response_time = avg_response_time / len([r for r in performance_results if r['response_time_ms'] < 9999])
        
        print(f"\n📊 INDEX EFFECTIVENESS SUMMARY:")
        print(f"   Effective Indexes: {effective_indexes}/{len(performance_results)}")
        print(f"   Average Filtered Query Time: {avg_response_time:.1f}ms")
        print(f"   Baseline Query Time: {baseline_time:.1f}ms")
        print(f"   Performance Ratio: {avg_response_time/baseline_time:.1f}x baseline")
        
        # Success criteria: at least 75% of indexes are effective
        overall_success = (effective_indexes / len(performance_results)) >= 0.75
        
        self.log_test("Performance - Database Indexes", overall_success,
                     f"{effective_indexes}/{len(performance_results)} indexes effective, avg: {avg_response_time:.1f}ms vs baseline: {baseline_time:.1f}ms")
        
        return overall_success

    def run_performance_tests(self):
        """Run all performance optimization tests"""
        print(f"🚀 Starting Admin Panel Performance Optimization Tests - {datetime.now()}")
        print(f"🌐 Base URL: {self.base_url}")
        print("=" * 80)
        
        # Authentication required for all tests
        if not self.test_login():
            print("❌ Login failed - stopping performance tests")
            return False
        
        # Run all performance tests
        performance_results = []
        
        performance_results.append(self.test_performance_api_nodes_filters())
        performance_results.append(self.test_performance_nodes_all_ids())
        performance_results.append(self.test_performance_stats_api())
        performance_results.append(self.test_performance_concurrent_requests())
        performance_results.append(self.test_performance_database_indexes())
        
        # Performance test summary
        passed_tests = sum(performance_results)
        total_tests = len(performance_results)
        
        print("\n" + "=" * 80)
        print(f"🏁 PERFORMANCE TEST SUMMARY: {passed_tests}/{total_tests} tests passed")
        print(f"📊 Success Rate: {(passed_tests/total_tests)*100:.1f}%")
        
        if passed_tests == total_tests:
            print("🎉 All performance tests passed! Admin panel optimizations are working correctly.")
        else:
            print(f"⚠️  {total_tests - passed_tests} performance tests failed - optimizations may need review")
        
        # Logout
        self.test_logout()
        
        return passed_tests == total_tests

if __name__ == "__main__":
    tester = PerformanceTester()
    tester.run_performance_tests()