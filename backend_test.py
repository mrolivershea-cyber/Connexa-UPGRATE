#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, List

class ConnexaAPITester:
    def __init__(self, base_url="https://connexa-admin.preview.emergentagent.com"):
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

    def test_health_check(self):
        """Test health endpoint"""
        success, response = self.make_request('GET', '../health')
        self.log_test("Health Check", success, 
                     "" if success else f"Health check failed: {response}")
        return success

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

    def test_get_current_user(self):
        """Test getting current user info"""
        success, response = self.make_request('GET', 'auth/me')
        
        if success and 'username' in response:
            self.log_test("Get Current User", True)
            return True
        else:
            self.log_test("Get Current User", False, f"Failed to get user info: {response}")
            return False

    def test_get_nodes(self):
        """Test getting nodes list"""
        success, response = self.make_request('GET', 'nodes')
        
        if success and 'nodes' in response:
            self.log_test("Get Nodes", True, f"Found {len(response['nodes'])} nodes")
            return response['nodes']
        else:
            self.log_test("Get Nodes", False, f"Failed to get nodes: {response}")
            return []

    def test_get_stats(self):
        """Test getting statistics"""
        success, response = self.make_request('GET', 'stats')
        
        if success and 'total' in response:
            self.log_test("Get Statistics", True, 
                         f"Total: {response['total']}, Online: {response.get('online', 0)}")
            return True
        else:
            self.log_test("Get Statistics", False, f"Failed to get stats: {response}")
            return False

    def test_create_node(self):
        """Test creating a new node"""
        test_node = {
            "ip": "203.0.113.10",
            "login": "vpnuser01",
            "password": "SecurePass123!",
            "protocol": "pptp",
            "provider": "CloudVPN Services",
            "country": "United States",
            "state": "California",
            "city": "Los Angeles",
            "zipcode": "90210",
            "comment": "Test node created by automated test"
        }
        
        success, response = self.make_request('POST', 'nodes', test_node, 200)
        
        if success and 'id' in response:
            self.log_test("Create Node", True, f"Created node with ID: {response['id']}")
            return response['id']
        else:
            self.log_test("Create Node", False, f"Failed to create node: {response}")
            return None

    def test_update_node(self, node_id: int):
        """Test updating a node"""
        if not node_id:
            self.log_test("Update Node", False, "No node ID provided")
            return False
            
        update_data = {
            "comment": "Updated by automated test",
            "provider": "UpdatedProvider"
        }
        
        success, response = self.make_request('PUT', f'nodes/{node_id}', update_data)
        
        if success:
            self.log_test("Update Node", True, f"Updated node {node_id}")
            return True
        else:
            self.log_test("Update Node", False, f"Failed to update node: {response}")
            return False

    def test_node_filtering(self):
        """Test node filtering functionality"""
        filters = {
            "protocol": "pptp",
            "limit": 10
        }
        
        success, response = self.make_request('GET', 'nodes', filters)
        
        if success and 'nodes' in response:
            self.log_test("Node Filtering", True, f"Filtered results: {len(response['nodes'])} nodes")
            return True
        else:
            self.log_test("Node Filtering", False, f"Failed to filter nodes: {response}")
            return False

    def test_import_nodes(self):
        """Test importing nodes from text (legacy endpoint)"""
        import_data = {
            "data": """Ip: 10.0.0.1
Login: admin
Pass: secret
State: Texas
City: Austin

10.0.0.2 user pass CA""",
            "protocol": "pptp"
        }
        
        success, response = self.make_request('POST', 'import', import_data)
        
        if success and 'created' in response:
            self.log_test("Import Nodes (Legacy)", True, 
                         f"Created: {response['created']}, Duplicates: {response.get('duplicates', 0)}")
            return True
        else:
            self.log_test("Import Nodes (Legacy)", False, f"Failed to import nodes: {response}")
            return False

    def test_enhanced_import_format_1(self):
        """Test enhanced import API with Format 1: Key-value pairs"""
        import_data = {
            "data": """Ip: 192.168.1.100
Login: vpnuser1
Pass: SecurePass123
State: CA
City: San Francisco
Zip: 94102
Country: US
Provider: TechVPN

Ip: 192.168.1.101
Login: vpnuser2
Pass: AnotherPass456
State: TX
City: Houston
Zip: 77001
Country: US
Provider: FastVPN""",
            "protocol": "pptp"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Enhanced Import Format 1", True, 
                         f"Added: {report.get('added', 0)}, Skipped: {report.get('skipped_duplicates', 0)}, Format Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Enhanced Import Format 1", False, f"Failed to import: {response}")
            return False

    def test_enhanced_import_format_2(self):
        """Test enhanced import API with Format 2: Single line with spaces"""
        import_data = {
            "data": """192.168.2.100 MyPass123 vpnuser3 California
192.168.2.101 SecretPass456 vpnuser4 Texas
192.168.2.102 StrongPass789 vpnuser5 NewYork""",
            "protocol": "ssh"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Enhanced Import Format 2", True, 
                         f"Added: {report.get('added', 0)}, Skipped: {report.get('skipped_duplicates', 0)}, Format Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Enhanced Import Format 2", False, f"Failed to import: {response}")
            return False

    def test_enhanced_import_format_3(self):
        """Test enhanced import API with Format 3: Dash/pipe format"""
        import_data = {
            "data": """192.168.3.100 - vpnuser6:MyPassword123 - California/Los Angeles 90210 | 2024-01-15
192.168.3.101 - vpnuser7:SecurePass456 - Texas/Dallas 75201 | 2024-01-16""",
            "protocol": "socks"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Enhanced Import Format 3", True, 
                         f"Added: {report.get('added', 0)}, Skipped: {report.get('skipped_duplicates', 0)}, Format Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Enhanced Import Format 3", False, f"Failed to import: {response}")
            return False

    def test_enhanced_import_format_4(self):
        """Test enhanced import API with Format 4: Colon separated"""
        import_data = {
            "data": """192.168.4.100:vpnuser8:MyPass123:US:California:94102
192.168.4.101:vpnuser9:SecurePass456:CA:Ontario:M5V3A8
192.168.4.102:vpnuser10:StrongPass789:AU:NSW:2000""",
            "protocol": "server"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Enhanced Import Format 4", True, 
                         f"Added: {report.get('added', 0)}, Skipped: {report.get('skipped_duplicates', 0)}, Format Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Enhanced Import Format 4", False, f"Failed to import: {response}")
            return False

    def test_enhanced_import_format_5(self):
        """Test enhanced import API with Format 5: Multi-line with Location"""
        import_data = {
            "data": """IP: 192.168.5.100
Credentials: vpnuser11:MyPassword123
Location: California (San Francisco)
ZIP: 94102

IP: 192.168.5.101
Credentials: vpnuser12:SecurePass456
Location: Texas (Houston)
ZIP: 77001""",
            "protocol": "ovpn"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Enhanced Import Format 5", True, 
                         f"Added: {report.get('added', 0)}, Skipped: {report.get('skipped_duplicates', 0)}, Format Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Enhanced Import Format 5", False, f"Failed to import: {response}")
            return False

    def test_enhanced_import_format_6(self):
        """Test enhanced import API with Format 6: Multi-line with PPTP header"""
        import_data = {
            "data": """PPTP_SVOIM_VPN Connection Details
PPTP Connection Information
IP: 192.168.6.100
Credentials: vpnuser13:MyPassword123
Location: California (Los Angeles)
ZIP: 90210

PPTP_SVOIM_VPN Connection Details
PPTP Connection Information  
IP: 192.168.6.101
Credentials: vpnuser14:SecurePass456
Location: New York (New York)
ZIP: 10001""",
            "protocol": "pptp"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Enhanced Import Format 6", True, 
                         f"Added: {report.get('added', 0)}, Skipped: {report.get('skipped_duplicates', 0)}, Format Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Enhanced Import Format 6", False, f"Failed to import: {response}")
            return False

    def test_deduplication_logic(self):
        """Test deduplication logic with duplicate entries"""
        # First, import some nodes
        import_data = {
            "data": """Ip: 10.10.10.100
Login: testuser1
Pass: testpass123
State: CA
City: Los Angeles""",
            "protocol": "pptp"
        }
        
        success1, response1 = self.make_request('POST', 'nodes/import', import_data)
        
        # Try to import the same node again (should be skipped as duplicate)
        success2, response2 = self.make_request('POST', 'nodes/import', import_data)
        
        if success1 and success2 and 'report' in response2:
            report = response2['report']
            if report.get('skipped_duplicates', 0) > 0:
                self.log_test("Deduplication Logic", True, 
                             f"Correctly skipped {report['skipped_duplicates']} duplicates")
                return True
            else:
                self.log_test("Deduplication Logic", False, "Expected duplicates to be skipped")
                return False
        else:
            self.log_test("Deduplication Logic", False, f"Failed to test deduplication: {response2}")
            return False

    def test_country_state_normalization(self):
        """Test country and state code normalization"""
        import_data = {
            "data": """Ip: 10.11.11.100
Login: normalizeuser1
Pass: normalizepass123
State: CA
Country: US
City: Los Angeles

Ip: 10.11.11.101
Login: normalizeuser2
Pass: normalizepass456
State: ON
Country: CA
City: Toronto

Ip: 10.11.11.102
Login: normalizeuser3
Pass: normalizepass789
State: NSW
Country: AU
City: Sydney""",
            "protocol": "pptp"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            # Check if nodes were created and then verify normalization by getting nodes
            nodes_success, nodes_response = self.make_request('GET', 'nodes?limit=50')
            
            if nodes_success and 'nodes' in nodes_response:
                # Look for our test nodes and check if states are normalized
                test_nodes = [node for node in nodes_response['nodes'] 
                             if node.get('login', '').startswith('normalizeuser')]
                
                normalized_found = False
                for node in test_nodes:
                    if (node.get('state') == 'California' or 
                        node.get('state') == 'Ontario' or 
                        node.get('state') == 'New South Wales'):
                        normalized_found = True
                        break
                
                if normalized_found:
                    self.log_test("Country/State Normalization", True, 
                                 f"Found normalized states in {len(test_nodes)} test nodes")
                    return True
                else:
                    self.log_test("Country/State Normalization", False, 
                                 "State normalization not working as expected")
                    return False
            else:
                self.log_test("Country/State Normalization", False, 
                             "Could not retrieve nodes to verify normalization")
                return False
        else:
            self.log_test("Country/State Normalization", False, f"Failed to import: {response}")
            return False

    def test_format_errors_api(self):
        """Test format errors API endpoints"""
        # First, try to import some invalid data to generate format errors
        import_data = {
            "data": """Invalid data without proper format
Another invalid line
Not a valid IP or format
Random text that should cause errors""",
            "protocol": "pptp"
        }
        
        # Import invalid data (should generate format errors)
        self.make_request('POST', 'nodes/import', import_data)
        
        # Test GET format errors
        success1, response1 = self.make_request('GET', 'format-errors')
        
        if success1 and 'content' in response1:
            self.log_test("Get Format Errors", True, 
                         f"Retrieved format errors: {len(response1.get('content', ''))} characters")
            
            # Test DELETE format errors
            success2, response2 = self.make_request('DELETE', 'format-errors')
            
            if success2:
                self.log_test("Clear Format Errors", True, "Format errors cleared successfully")
                return True
            else:
                self.log_test("Clear Format Errors", False, f"Failed to clear: {response2}")
                return False
        else:
            self.log_test("Get Format Errors", False, f"Failed to get format errors: {response1}")
            return False

    def test_mixed_format_import(self):
        """Test importing mixed formats in single request"""
        import_data = {
            "data": """Ip: 10.12.12.100
Login: mixeduser1
Pass: mixedpass123
State: CA

10.12.12.101 mixedpass456 mixeduser2 Texas

10.12.12.102:mixeduser3:mixedpass789:US:Florida:33101""",
            "protocol": "pptp"
        }
        
        success, response = self.make_request('POST', 'nodes/import', import_data)
        
        if success and 'report' in response:
            report = response['report']
            self.log_test("Mixed Format Import", True, 
                         f"Processed mixed formats - Added: {report.get('added', 0)}, Errors: {report.get('format_errors', 0)}")
            return True
        else:
            self.log_test("Mixed Format Import", False, f"Failed to import mixed formats: {response}")
            return False

    def test_export_nodes(self, node_ids: List[int]):
        """Test exporting nodes"""
        if not node_ids:
            self.log_test("Export Nodes", False, "No node IDs provided")
            return False
            
        export_data = {
            "node_ids": node_ids[:2],  # Export first 2 nodes
            "format": "csv"
        }
        
        success, response = self.make_request('POST', 'export', export_data)
        
        if success and 'data' in response:
            self.log_test("Export Nodes", True, f"Exported {len(node_ids[:2])} nodes")
            return True
        else:
            self.log_test("Export Nodes", False, f"Failed to export nodes: {response}")
            return False

    def test_autocomplete_endpoints(self):
        """Test autocomplete endpoints"""
        endpoints = ['countries', 'states', 'cities', 'providers']
        all_passed = True
        
        for endpoint in endpoints:
            success, response = self.make_request('GET', f'autocomplete/{endpoint}')
            if success and isinstance(response, list):
                self.log_test(f"Autocomplete {endpoint.title()}", True, f"Found {len(response)} items")
            else:
                self.log_test(f"Autocomplete {endpoint.title()}", False, f"Failed: {response}")
                all_passed = False
        
        return all_passed

    def test_delete_node(self, node_id: int):
        """Test deleting a node"""
        if not node_id:
            self.log_test("Delete Node", False, "No node ID provided")
            return False
            
        success, response = self.make_request('DELETE', f'nodes/{node_id}')
        
        if success:
            self.log_test("Delete Node", True, f"Deleted node {node_id}")
            return True
        else:
            self.log_test("Delete Node", False, f"Failed to delete node: {response}")
            return False

    def test_bulk_delete_nodes(self, node_ids: List[int]):
        """Test bulk deleting nodes"""
        if not node_ids:
            self.log_test("Bulk Delete Nodes", False, "No node IDs provided")
            return False
            
        delete_data = {"node_ids": node_ids[:1]}  # Delete 1 node
        success, response = self.make_request('DELETE', 'nodes', delete_data)
        
        if success:
            self.log_test("Bulk Delete Nodes", True, f"Bulk deleted nodes")
            return True
        else:
            self.log_test("Bulk Delete Nodes", False, f"Failed to bulk delete: {response}")
            return False

    def test_change_password(self):
        """Test password change functionality"""
        # First, try to change password
        change_data = {
            "old_password": "admin",
            "new_password": "newpassword123",
            "confirm_password": "newpassword123"
        }
        
        success, response = self.make_request('POST', 'auth/change-password', change_data)
        
        if success:
            # Change it back to admin
            change_back_data = {
                "old_password": "newpassword123",
                "new_password": "admin",
                "confirm_password": "admin"
            }
            
            success2, response2 = self.make_request('POST', 'auth/change-password', change_back_data)
            
            if success2:
                self.log_test("Change Password", True, "Password changed and reverted successfully")
                return True
            else:
                self.log_test("Change Password", False, f"Failed to revert password: {response2}")
                return False
        else:
            self.log_test("Change Password", False, f"Failed to change password: {response}")
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

    def test_service_control_start(self, node_ids: List[int]):
        """Test starting services for nodes"""
        if not node_ids:
            self.log_test("Start Services", False, "No node IDs provided")
            return False
            
        service_data = {
            "node_ids": node_ids[:1],  # Test with 1 node
            "action": "start"
        }
        
        success, response = self.make_request('POST', 'services/start', service_data)
        
        if success and 'results' in response:
            self.log_test("Start Services", True, f"Service start attempted for {len(service_data['node_ids'])} nodes")
            return True
        else:
            self.log_test("Start Services", False, f"Failed to start services: {response}")
            return False

    def test_service_control_stop(self, node_ids: List[int]):
        """Test stopping services for nodes"""
        if not node_ids:
            self.log_test("Stop Services", False, "No node IDs provided")
            return False
            
        service_data = {
            "node_ids": node_ids[:1],  # Test with 1 node
            "action": "stop"
        }
        
        success, response = self.make_request('POST', 'services/stop', service_data)
        
        if success and 'results' in response:
            self.log_test("Stop Services", True, f"Service stop attempted for {len(service_data['node_ids'])} nodes")
            return True
        else:
            self.log_test("Stop Services", False, f"Failed to stop services: {response}")
            return False

    def test_service_status(self, node_id: int):
        """Test getting service status for a node"""
        if not node_id:
            self.log_test("Service Status", False, "No node ID provided")
            return False
            
        success, response = self.make_request('GET', f'services/status/{node_id}')
        
        if success:
            self.log_test("Service Status", True, f"Got service status for node {node_id}")
            return True
        else:
            self.log_test("Service Status", False, f"Failed to get service status: {response}")
            return False

    def test_ping_test(self, node_ids: List[int]):
        """Test ping functionality for nodes"""
        if not node_ids:
            self.log_test("Ping Test", False, "No node IDs provided")
            return False
            
        test_data = {
            "node_ids": node_ids[:1],  # Test with 1 node
            "test_type": "ping"
        }
        
        success, response = self.make_request('POST', 'test/ping', test_data)
        
        if success and 'results' in response:
            self.log_test("Ping Test", True, f"Ping test completed for {len(test_data['node_ids'])} nodes")
            return True
        else:
            self.log_test("Ping Test", False, f"Failed to run ping test: {response}")
            return False

    def test_speed_test(self, node_ids: List[int]):
        """Test speed functionality for nodes"""
        if not node_ids:
            self.log_test("Speed Test", False, "No node IDs provided")
            return False
            
        test_data = {
            "node_ids": node_ids[:1],  # Test with 1 node
            "test_type": "speed"
        }
        
        success, response = self.make_request('POST', 'test/speed', test_data)
        
        if success and 'results' in response:
            self.log_test("Speed Test", True, f"Speed test completed for {len(test_data['node_ids'])} nodes")
            return True
        else:
            self.log_test("Speed Test", False, f"Failed to run speed test: {response}")
            return False

    def test_combined_test(self, node_ids: List[int]):
        """Test combined ping+speed functionality for nodes"""
        if not node_ids:
            self.log_test("Combined Test", False, "No node IDs provided")
            return False
            
        test_data = {
            "node_ids": node_ids[:1],  # Test with 1 node
            "test_type": "both"
        }
        
        success, response = self.make_request('POST', 'test/combined', test_data)
        
        if success and 'results' in response:
            self.log_test("Combined Test", True, f"Combined test completed for {len(test_data['node_ids'])} nodes")
            return True
        else:
            self.log_test("Combined Test", False, f"Failed to run combined test: {response}")
            return False

    def test_single_node_test(self, node_id: int):
        """Test single node testing endpoint"""
        if not node_id:
            self.log_test("Single Node Test", False, "No node ID provided")
            return False
            
        success, response = self.make_request('POST', f'nodes/{node_id}/test?test_type=ping')
        
        if success:
            self.log_test("Single Node Test", True, f"Single node test completed for node {node_id}")
            return True
        else:
            self.log_test("Single Node Test", False, f"Failed to test single node: {response}")
            return False

    def test_single_node_service_start(self, node_id: int):
        """Test starting services for a single node"""
        if not node_id:
            self.log_test("Single Node Service Start", False, "No node ID provided")
            return False
            
        success, response = self.make_request('POST', f'nodes/{node_id}/services/start')
        
        if success:
            self.log_test("Single Node Service Start", True, f"Service start attempted for node {node_id}")
            return True
        else:
            self.log_test("Single Node Service Start", False, f"Failed to start service for single node: {response}")
            return False

    def test_single_node_service_stop(self, node_id: int):
        """Test stopping services for a single node"""
        if not node_id:
            self.log_test("Single Node Service Stop", False, "No node ID provided")
            return False
            
        success, response = self.make_request('POST', f'nodes/{node_id}/services/stop')
        
        if success:
            self.log_test("Single Node Service Stop", True, f"Service stop attempted for node {node_id}")
            return True
        else:
            self.log_test("Single Node Service Stop", False, f"Failed to stop service for single node: {response}")
            return False

    def test_create_node_with_auto_test(self):
        """Test creating node with automatic testing"""
        test_node = {
            "ip": "198.51.100.25",
            "login": "vpnuser02",
            "password": "AutoTest456!",
            "protocol": "ssh",
            "provider": "SecureVPN Corp",
            "country": "Canada",
            "state": "Ontario",
            "city": "Toronto",
            "zipcode": "M5V 3A8",
            "comment": "Auto-test node created by automated test"
        }
        
        success, response = self.make_request('POST', 'nodes/auto-test?test_type=ping', test_node)
        
        if success and 'node' in response and 'id' in response['node']:
            self.log_test("Create Node with Auto Test", True, f"Created and tested node with ID: {response['node']['id']}")
            return response['node']['id']
        elif success:
            self.log_test("Create Node with Auto Test", True, f"Node created with auto test, response: {response}")
            # Try to extract ID from response if structure is different
            if isinstance(response, dict) and 'id' in response:
                return response['id']
            return None
        else:
            self.log_test("Create Node with Auto Test", False, f"Failed to create node with auto test: {response}")
            return None

    def test_different_protocols(self):
        """Test creating nodes with different protocols"""
        protocols = ["pptp", "ssh", "socks", "server", "ovpn"]
        created_nodes = []
        
        for i, protocol in enumerate(protocols):
            test_node = {
                "ip": f"203.0.113.{20 + i}",
                "login": f"user_{protocol}",
                "password": f"Pass_{protocol}_123!",
                "protocol": protocol,
                "provider": f"{protocol.upper()} Provider",
                "country": "United States",
                "state": "New York",
                "city": "New York",
                "zipcode": "10001",
                "comment": f"Test {protocol} node"
            }
            
            success, response = self.make_request('POST', 'nodes', test_node)
            
            if success and 'id' in response:
                created_nodes.append(response['id'])
            else:
                self.log_test(f"Create {protocol.upper()} Node", False, f"Failed: {response}")
                return []
        
        self.log_test("Create Different Protocol Nodes", True, f"Created {len(created_nodes)} nodes with different protocols")
        return created_nodes

    def run_all_tests(self):
        """Run all backend tests"""
        print("🚀 Starting Connexa Backend API Tests")
        print("=" * 50)
        
        # Test health check first
        if not self.test_health_check():
            print("❌ Health check failed - stopping tests")
            return False
        
        # Test authentication
        if not self.test_login():
            print("❌ Login failed - stopping tests")
            return False
        
        # Test user info
        self.test_get_current_user()
        
        # Test basic CRUD operations
        nodes = self.test_get_nodes()
        self.test_get_stats()
        
        # Test node creation and manipulation
        new_node_id = self.test_create_node()
        if new_node_id:
            self.test_update_node(new_node_id)
        
        # Test creating node with auto-test
        auto_test_node_id = self.test_create_node_with_auto_test()
        
        # Test different protocol nodes
        protocol_node_ids = self.test_different_protocols()
        
        # Test filtering
        self.test_node_filtering()
        
        # Test import/export
        self.test_import_nodes()
        
        # Get updated node list for service and testing operations
        updated_nodes = self.test_get_nodes()
        if updated_nodes:
            node_ids = [node['id'] for node in updated_nodes]
            
            # Test export functionality
            self.test_export_nodes(node_ids)
            
            # Test service control endpoints
            if node_ids:
                self.test_service_control_start(node_ids)
                self.test_service_status(node_ids[0])
                self.test_service_control_stop(node_ids)
                
                # Test single node service operations
                if new_node_id:
                    self.test_single_node_service_start(new_node_id)
                    self.test_single_node_service_stop(new_node_id)
            
            # Test node testing endpoints
            if node_ids:
                self.test_ping_test(node_ids)
                self.test_speed_test(node_ids)
                self.test_combined_test(node_ids)
                
                # Test single node testing
                if new_node_id:
                    self.test_single_node_test(new_node_id)
            
            # Test delete operations (use newly created nodes)
            if new_node_id:
                self.test_delete_node(new_node_id)
            
            if auto_test_node_id:
                self.test_delete_node(auto_test_node_id)
            
            # Test bulk delete with protocol test nodes
            if protocol_node_ids:
                self.test_bulk_delete_nodes(protocol_node_ids)
        
        # Test autocomplete
        self.test_autocomplete_endpoints()
        
        # Test password change
        self.test_change_password()
        
        # Test logout
        self.test_logout()
        
        # Print summary
        print("\n" + "=" * 50)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        print(f"✅ Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    tester = ConnexaAPITester()
    success = tester.run_all_tests()
    
    # Save detailed results
    results = {
        "timestamp": datetime.now().isoformat(),
        "total_tests": tester.tests_run,
        "passed_tests": tester.tests_passed,
        "success_rate": (tester.tests_passed/tester.tests_run)*100 if tester.tests_run > 0 else 0,
        "test_details": tester.test_results
    }
    
    with open('/app/test_reports/backend_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())