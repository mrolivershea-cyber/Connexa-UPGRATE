#!/usr/bin/env python3

import requests
import json

def test_format_2_debug():
    """Debug Format 2 parsing issue"""
    base_url = "https://admin-ui-enhance-2.preview.emergentagent.com"
    api_url = f"{base_url}/api"
    
    # Login first
    login_data = {"username": "admin", "password": "admin"}
    login_response = requests.post(f"{api_url}/auth/login", json=login_data)
    
    if login_response.status_code != 200:
        print(f"❌ Login failed: {login_response.text}")
        return
    
    token = login_response.json()['access_token']
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    # Test Format 2 with exact data from review request
    import_data = {
        "data": "76.178.64.46 admin admin CA\n96.234.52.227 user1 pass1 NJ",
        "protocol": "pptp"
    }
    
    print("🔍 Testing Format 2 with data:")
    print(f"Data: {repr(import_data['data'])}")
    
    response = requests.post(f"{api_url}/nodes/import", json=import_data, headers=headers)
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    if response.status_code == 200:
        report = response.json().get('report', {})
        print(f"\nAdded: {report.get('added', 0)}")
        print(f"Skipped: {report.get('skipped_duplicates', 0)}")
        print(f"Format Errors: {report.get('format_errors', 0)}")
        
        # Check if nodes were created
        if report.get('added', 0) > 0:
            # Get the nodes to verify parsing
            nodes_response = requests.get(f"{api_url}/nodes?ip=76.178.64.46", headers=headers)
            if nodes_response.status_code == 200:
                nodes = nodes_response.json().get('nodes', [])
                if nodes:
                    node = nodes[0]
                    print(f"\nNode 1 parsed as:")
                    print(f"IP: {node.get('ip')}")
                    print(f"Login: {node.get('login')}")
                    print(f"Password: {node.get('password')}")
                    print(f"State: {node.get('state')}")
                    
                    # Check if order is correct: IP Login Password State
                    if (node.get('ip') == '76.178.64.46' and 
                        node.get('login') == 'admin' and 
                        node.get('password') == 'admin' and 
                        node.get('state') == 'California'):
                        print("✅ Format 2 parsing is CORRECT")
                    else:
                        print("❌ Format 2 parsing is WRONG")

def test_format_5_debug():
    """Debug Format 5 parsing issue"""
    base_url = "https://admin-ui-enhance-2.preview.emergentagent.com"
    api_url = f"{base_url}/api"
    
    # Login first
    login_data = {"username": "admin", "password": "admin"}
    login_response = requests.post(f"{api_url}/auth/login", json=login_data)
    
    if login_response.status_code != 200:
        print(f"❌ Login failed: {login_response.text}")
        return
    
    token = login_response.json()['access_token']
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    # Test Format 5 with exact data from review request
    import_data = {
        "data": "IP: 24.227.222.13\nCredentials: admin:admin\nLocation: Texas (Austin)\nZIP: 78701",
        "protocol": "pptp"
    }
    
    print("🔍 Testing Format 5 with data:")
    print(f"Data: {repr(import_data['data'])}")
    
    response = requests.post(f"{api_url}/nodes/import", json=import_data, headers=headers)
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

def test_comment_filtering_debug():
    """Debug comment filtering issue"""
    base_url = "https://admin-ui-enhance-2.preview.emergentagent.com"
    api_url = f"{base_url}/api"
    
    # Login first
    login_data = {"username": "admin", "password": "admin"}
    login_response = requests.post(f"{api_url}/auth/login", json=login_data)
    
    if login_response.status_code != 200:
        print(f"❌ Login failed: {login_response.text}")
        return
    
    token = login_response.json()['access_token']
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    # Test comment filtering with exact data from review request
    import_data = {
        "data": "# This is a comment\n\n76.178.64.50 admin password TX  // inline comment\n\n# Another comment\n96.234.52.230 user pass CA",
        "protocol": "pptp"
    }
    
    print("🔍 Testing comment filtering with data:")
    print(f"Data: {repr(import_data['data'])}")
    
    response = requests.post(f"{api_url}/nodes/import", json=import_data, headers=headers)
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

if __name__ == "__main__":
    print("🐛 Debug Parser Issues")
    print("=" * 40)
    
    print("\n1. Format 2 Debug:")
    test_format_2_debug()
    
    print("\n2. Format 5 Debug:")
    test_format_5_debug()
    
    print("\n3. Comment Filtering Debug:")
    test_comment_filtering_debug()