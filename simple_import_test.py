#!/usr/bin/env python3

import requests
import json
import time

def test_import_functionality():
    """Test the import functionality with different testing modes"""
    
    # Use local backend URL
    base_url = "http://localhost:8001"
    api_url = f"{base_url}/api"
    
    # Login first
    login_data = {"username": "admin", "password": "admin"}
    
    try:
        login_response = requests.post(f"{api_url}/auth/login", json=login_data, timeout=10)
        if login_response.status_code != 200:
            print(f"❌ Login failed: {login_response.text}")
            return False
        
        token = login_response.json().get('access_token')
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}'
        }
        
        print("✅ Login successful")
        
        # Test 1: Import with ping_only mode
        print("\n🔥 TEST 1: Import with ping_only mode")
        test_data = """72.197.30.147 admin admin US
100.11.102.204 admin admin US  
200.1.1.1 admin admin US"""
        
        import_data = {
            "data": test_data,
            "protocol": "pptp",
            "testing_mode": "ping_only"
        }
        
        import_response = requests.post(f"{api_url}/nodes/import", json=import_data, headers=headers, timeout=30)
        
        if import_response.status_code == 200:
            result = import_response.json()
            print(f"✅ Import successful: {result.get('message', 'No message')}")
            if 'report' in result:
                report = result['report']
                print(f"   Added: {report.get('added', 0)}")
                print(f"   Format errors: {report.get('format_errors', 0)}")
                print(f"   Testing mode: {report.get('testing_mode', 'unknown')}")
        else:
            print(f"❌ Import failed: {import_response.text}")
            return False
        
        # Wait a bit for testing to start
        time.sleep(5)
        
        # Test 2: Import with ping_speed mode
        print("\n🔥 TEST 2: Import with ping_speed mode")
        test_data2 = """72.197.30.148 admin admin US
100.11.102.205 admin admin US"""
        
        import_data2 = {
            "data": test_data2,
            "protocol": "pptp",
            "testing_mode": "ping_speed"
        }
        
        import_response2 = requests.post(f"{api_url}/nodes/import", json=import_data2, headers=headers, timeout=30)
        
        if import_response2.status_code == 200:
            result2 = import_response2.json()
            print(f"✅ Import successful: {result2.get('message', 'No message')}")
            if 'report' in result2:
                report2 = result2['report']
                print(f"   Added: {report2.get('added', 0)}")
                print(f"   Format errors: {report2.get('format_errors', 0)}")
                print(f"   Testing mode: {report2.get('testing_mode', 'unknown')}")
        else:
            print(f"❌ Import failed: {import_response2.text}")
            return False
        
        # Test 3: Check for nodes stuck in checking status
        print("\n🔥 TEST 3: Check for nodes stuck in 'checking' status")
        
        # Wait a bit more for any testing to complete
        time.sleep(10)
        
        checking_response = requests.get(f"{api_url}/nodes?status=checking", headers=headers, timeout=10)
        
        if checking_response.status_code == 200:
            checking_result = checking_response.json()
            checking_nodes = checking_result.get('nodes', [])
            checking_count = len(checking_nodes)
            
            print(f"   Nodes stuck in 'checking': {checking_count}")
            
            if checking_count == 0:
                print("✅ No nodes stuck in 'checking' status")
            else:
                print(f"❌ {checking_count} nodes stuck in 'checking' status")
                for node in checking_nodes[:5]:  # Show first 5
                    print(f"     - Node {node.get('id')}: {node.get('ip')} ({node.get('status')})")
        else:
            print(f"❌ Failed to check nodes: {checking_response.text}")
        
        # Test 4: Check specific node statuses
        print("\n🔥 TEST 4: Check specific node statuses")
        
        test_ips = ['72.197.30.147', '72.197.30.148', '100.11.102.204']
        
        for ip in test_ips:
            node_response = requests.get(f"{api_url}/nodes?ip={ip}", headers=headers, timeout=10)
            
            if node_response.status_code == 200:
                node_result = node_response.json()
                nodes = node_result.get('nodes', [])
                
                if nodes:
                    node = nodes[0]
                    status = node.get('status')
                    print(f"   {ip}: {status}")
                else:
                    print(f"   {ip}: Not found")
            else:
                print(f"   {ip}: Error checking status")
        
        print("\n🏁 IMPORT TESTING COMPLETED")
        return True
        
    except Exception as e:
        print(f"❌ Test failed with exception: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_import_functionality()
    if success:
        print("🎉 Import testing completed successfully")
    else:
        print("❌ Import testing failed")