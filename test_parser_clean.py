#!/usr/bin/env python3

import requests
import json
import time

def test_all_formats_clean():
    """Test all 6 formats with unique IPs to avoid duplicates"""
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
    
    # Use timestamp to ensure unique IPs (but keep them valid)
    timestamp = str(int(time.time()))[-2:]  # Last 2 digits
    # Ensure the timestamp is within valid IP range (0-255)
    ip_suffix = str(int(timestamp) % 200 + 50)  # Range 50-249
    
    tests = [
        {
            "name": "Format 1 - Key-Value Pairs",
            "data": f"Ip: 144.229.{timestamp}.35\nLogin: admin\nPass: admin\nState: California\nCity: Los Angeles\nZip: 90035",
            "expected_nodes": 1
        },
        {
            "name": "Format 2 - Single Line (CRITICAL)",
            "data": f"76.178.{timestamp}.46 admin admin CA\n96.234.{timestamp}.227 user1 pass1 NJ",
            "expected_nodes": 2
        },
        {
            "name": "Format 3 - Dash/Pipe with Timestamp",
            "data": f"68.227.{timestamp}.4 - admin:admin - Arizona/Phoenix 85001 | 2025-09-03 16:05:25\n96.42.{timestamp}.97 - user:pass - Michigan/Lapeer 48446 | 2025-09-03 09:50:22",
            "expected_nodes": 2
        },
        {
            "name": "Format 4 - Colon Separated",
            "data": f"70.171.{timestamp}.52:admin:admin:US:Arizona:85001",
            "expected_nodes": 1
        },
        {
            "name": "Format 5 - 4-Line Multi-line",
            "data": f"IP: 24.227.{timestamp}.13\nCredentials: admin:admin\nLocation: Texas (Austin)\nZIP: 78701",
            "expected_nodes": 1
        },
        {
            "name": "Format 6 - PPTP Header",
            "data": f"> PPTP_SVOIM_VPN:\n🚨 PPTP Connection\nIP: 24.227.{timestamp}.14\nCredentials: testuser:testpass\nLocation: Florida (Miami)\nZIP: 33101",
            "expected_nodes": 1
        },
        {
            "name": "Edge Cases - Comments",
            "data": f"# This is a comment\n\n76.178.{timestamp}.50 admin password TX  // inline comment\n\n# Another comment\n96.234.{timestamp}.230 user pass CA",
            "expected_nodes": 2
        },
        {
            "name": "Mixed Formats",
            "data": f"Ip: 10.0.{timestamp}.1\nLogin: admin\nPass: pass1\nState: CA\n---------------------\n10.0.{timestamp}.2 user2 pass2 NY\n---------------------\n10.0.{timestamp}.3:admin:admin:US:Texas:78701",
            "expected_nodes": 3
        }
    ]
    
    results = []
    
    for test in tests:
        print(f"\n🔍 Testing: {test['name']}")
        
        import_data = {
            "data": test["data"],
            "protocol": "pptp"
        }
        
        response = requests.post(f"{api_url}/nodes/import", json=import_data, headers=headers)
        
        if response.status_code == 200:
            report = response.json().get('report', {})
            added = report.get('added', 0)
            skipped = report.get('skipped_duplicates', 0)
            errors = report.get('format_errors', 0)
            
            success = added == test['expected_nodes']
            status = "✅ PASSED" if success else "❌ FAILED"
            
            print(f"{status} - Expected: {test['expected_nodes']}, Added: {added}, Skipped: {skipped}, Errors: {errors}")
            
            if not success:
                print(f"  Details: {report}")
            
            results.append({
                "test": test['name'],
                "success": success,
                "expected": test['expected_nodes'],
                "added": added,
                "skipped": skipped,
                "errors": errors
            })
        else:
            print(f"❌ FAILED - HTTP {response.status_code}: {response.text}")
            results.append({
                "test": test['name'],
                "success": False,
                "error": f"HTTP {response.status_code}"
            })
    
    # Summary
    passed = sum(1 for r in results if r.get('success', False))
    total = len(results)
    
    print(f"\n📊 COMPREHENSIVE PARSER TEST RESULTS")
    print(f"=" * 50)
    print(f"Passed: {passed}/{total} ({(passed/total)*100:.1f}%)")
    
    for result in results:
        status = "✅" if result.get('success', False) else "❌"
        print(f"{status} {result['test']}")
    
    return passed == total

if __name__ == "__main__":
    test_all_formats_clean()