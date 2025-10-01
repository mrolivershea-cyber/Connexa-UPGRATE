#!/usr/bin/env python3

import requests
import json
from datetime import datetime
import time

# Test the specific scenarios from the review request
BASE_URL = "https://node-time-repair.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

def login():
    """Login and get token"""
    login_data = {"username": "admin", "password": "admin"}
    response = requests.post(f"{API_URL}/auth/login", json=login_data)
    if response.status_code == 200:
        return response.json()['access_token']
    return None

def test_timestamp_scenarios():
    """Test the specific scenarios from review request"""
    token = login()
    if not token:
        print("❌ Login failed")
        return
    
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    print("🕒 TIMESTAMP FIX VERIFICATION - Review Request Scenarios")
    print("=" * 60)
    
    # Scenario 1: Import new nodes via POST /api/nodes/import
    print("\n1. Testing import new nodes via POST /api/nodes/import")
    timestamp = str(int(time.time()))
    import_data = {
        "data": f"testuser{timestamp}:testpass@10.10.10.{timestamp[-2:]}:1723",
        "protocol": "pptp",
        "testing_mode": "no_test"
    }
    
    before_import = datetime.now()
    response = requests.post(f"{API_URL}/nodes/import", json=import_data, headers=headers)
    after_import = datetime.now()
    
    if response.status_code == 200:
        result = response.json()
        if result.get('report', {}).get('added', 0) > 0:
            print(f"✅ Import successful: {result['report']['added']} nodes added")
            
            # Get the imported node
            ip = f"10.10.10.{timestamp[-2:]}"
            response = requests.get(f"{API_URL}/nodes?ip={ip}", headers=headers)
            if response.status_code == 200:
                nodes = response.json()['nodes']
                if nodes:
                    node = nodes[0]
                    last_update_str = node.get('last_update')
                    if last_update_str:
                        try:
                            last_update = datetime.fromisoformat(last_update_str.replace('Z', '+00:00'))
                            time_diff = abs((after_import - last_update).total_seconds())
                            
                            if time_diff <= 120:  # Within 2 minutes
                                print(f"✅ IMPORT TIMESTAMP CORRECT: {last_update_str} (diff: {time_diff:.1f}s)")
                            else:
                                print(f"❌ IMPORT TIMESTAMP TOO OLD: {last_update_str} (diff: {time_diff:.1f}s)")
                        except Exception as e:
                            print(f"❌ TIMESTAMP PARSE ERROR: {e}")
                    else:
                        print("❌ NO TIMESTAMP IN RESPONSE")
                else:
                    print("❌ IMPORTED NODE NOT FOUND")
            else:
                print(f"❌ Failed to get imported node: {response.status_code}")
        else:
            print(f"❌ No nodes added: {result}")
    else:
        print(f"❌ Import failed: {response.status_code} - {response.text}")
    
    # Scenario 2: Create single node via POST /api/nodes
    print("\n2. Testing create single node via POST /api/nodes")
    timestamp = str(int(time.time()))
    node_data = {
        "ip": f"11.11.11.{timestamp[-2:]}",
        "login": "test",
        "password": "test123",
        "protocol": "pptp"
    }
    
    before_create = datetime.now()
    response = requests.post(f"{API_URL}/nodes", json=node_data, headers=headers)
    after_create = datetime.now()
    
    if response.status_code == 200:
        node = response.json()
        last_update_str = node.get('last_update')
        if last_update_str:
            try:
                last_update = datetime.fromisoformat(last_update_str.replace('Z', '+00:00'))
                time_diff = abs((after_create - last_update).total_seconds())
                
                if time_diff <= 60:  # Within 1 minute
                    print(f"✅ CREATE TIMESTAMP CORRECT: {last_update_str} (diff: {time_diff:.1f}s)")
                else:
                    print(f"❌ CREATE TIMESTAMP TOO OLD: {last_update_str} (diff: {time_diff:.1f}s)")
            except Exception as e:
                print(f"❌ TIMESTAMP PARSE ERROR: {e}")
        else:
            print("❌ NO TIMESTAMP IN RESPONSE")
    else:
        print(f"❌ Create failed: {response.status_code} - {response.text}")
    
    # Scenario 3: Query nodes via GET /api/nodes
    print("\n3. Testing query nodes via GET /api/nodes")
    response = requests.get(f"{API_URL}/nodes?limit=10", headers=headers)
    
    if response.status_code == 200:
        result = response.json()
        nodes = result.get('nodes', [])
        if nodes:
            print(f"✅ Retrieved {len(nodes)} nodes")
            
            # Check timestamps of first few nodes
            recent_nodes = 0
            old_nodes = 0
            now = datetime.now()
            
            for i, node in enumerate(nodes[:5]):  # Check first 5 nodes
                last_update_str = node.get('last_update')
                if last_update_str:
                    try:
                        last_update = datetime.fromisoformat(last_update_str.replace('Z', '+00:00'))
                        time_diff = abs((now - last_update).total_seconds())
                        
                        if time_diff <= 3600:  # Within 1 hour
                            recent_nodes += 1
                            print(f"  Node {node['id']}: ✅ Recent ({time_diff/60:.1f} min ago)")
                        else:
                            old_nodes += 1
                            print(f"  Node {node['id']}: ⏰ Old ({time_diff/3600:.1f} hours ago)")
                    except Exception as e:
                        print(f"  Node {node['id']}: ❌ Parse error: {e}")
                else:
                    print(f"  Node {node['id']}: ❌ No timestamp")
            
            print(f"Summary: {recent_nodes} recent nodes, {old_nodes} old nodes")
        else:
            print("❌ NO NODES FOUND")
    else:
        print(f"❌ Query failed: {response.status_code} - {response.text}")
    
    print("\n" + "=" * 60)
    print("TIMESTAMP FIX VERIFICATION COMPLETE")

if __name__ == "__main__":
    test_timestamp_scenarios()