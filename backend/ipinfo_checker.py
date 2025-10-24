"""
ipinfo.io Integration - Геолокация IP
Требует API токен, бесплатно 50,000 запросов/месяц
"""
import aiohttp
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

class IpinfoChecker:
    def __init__(self, api_token: str = None):
        self.api_token = api_token or os.getenv('IPINFO_TOKEN', '')
        self.base_url = "https://ipinfo.io"
    
    async def get_geolocation(self, ip: str) -> dict:
        """Получить геолокацию через ipinfo.io"""
        if not self.api_token:
            return {'success': False, 'error': 'API token not configured'}
        
        try:
            url = f"{self.base_url}/{ip}/json?token={self.api_token}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        if 'error' in data:
                            return {'success': False, 'error': data['error']['message']}
                        
                        # Parse "City, State ZIP" format
                        loc_parts = data.get('loc', '').split(',')
                        
                        return {
                            'success': True,
                            'country': data.get('country', ''),
                            'state': data.get('region', ''),
                            'city': data.get('city', ''),
                            'zipcode': data.get('postal', ''),
                            'provider': data.get('org', '')
                        }
                    else:
                        return {'success': False, 'error': f'HTTP {response.status}'}
        except Exception as e:
            logger.error(f"ipinfo.io error for {ip}: {e}")
            return {'success': False, 'error': str(e)}

ipinfo_checker = IpinfoChecker()
