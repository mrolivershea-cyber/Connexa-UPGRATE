"""
Service Manager - Управление всеми чекерами
Выбирает активный сервис на основе настроек
"""
import os
import logging

logger = logging.getLogger(__name__)

class ServiceManager:
    def __init__(self):
        self.active_geo_service = 'ip-api'  # По умолчанию
        self.active_fraud_service = 'ipqs'  # По умолчанию
    
    async def get_geolocation(self, ip: str) -> dict:
        """Получить геолокацию через активный сервис"""
        service = os.getenv('GEO_SERVICE', self.active_geo_service)
        
        try:
            if service == 'ip-api':
                from ip_geolocation import get_ip_geolocation
                result = await get_ip_geolocation(ip)
            elif service == 'ipapi.co':
                from ipapico_checker import ipapico_checker
                result = await ipapico_checker.get_geolocation(ip)
            elif service == 'ipinfo':
                from ipinfo_checker import ipinfo_checker
                result = await ipinfo_checker.get_geolocation(ip)
            elif service == 'maxmind':
                from maxmind_checker import maxmind_checker
                result = await maxmind_checker.get_geolocation(ip)
            else:
                # Fallback
                from ip_geolocation import get_ip_geolocation
                result = await get_ip_geolocation(ip)
            
            return result
        except Exception as e:
            logger.error(f"Geolocation service error: {e}")
            return {'success': False, 'error': str(e)}
    
    async def check_fraud(self, ip: str) -> dict:
        """Проверить fraud через активный сервис"""
        service = os.getenv('FRAUD_SERVICE', self.active_fraud_service)
        
        try:
            if service == 'ipqs':
                from ipqs_checker import ipqs_checker
                result = await ipqs_checker.check_ip(ip)
            elif service == 'abuseipdb':
                from abuseipdb_checker import abuseipdb_checker
                result = await abuseipdb_checker.check_ip(ip)
            else:
                # Fallback
                from ipqs_checker import ipqs_checker
                result = await ipqs_checker.check_ip(ip)
            
            return result
        except Exception as e:
            logger.error(f"Fraud service error: {e}")
            return {'success': False, 'error': str(e)}
    
    async def enrich_node_complete(self, node, db_session):
        """
        УМНАЯ ЛОГИКА: Обогатить узел ВСЕМИ данными
        Если используется IPQualityScore - один запрос для гео + fraud
        Иначе - два отдельных запроса
        """
        fraud_service = os.getenv('FRAUD_SERVICE', self.active_fraud_service)
        
        # УМНАЯ ЛОГИКА: IPQualityScore даёт ВСЁ в одном запросе
        if fraud_service == 'ipqs':
            logger.info(f"🎯 Using IPQualityScore for ALL data (geo + fraud) for {node.ip}")
            try:
                from ipqs_checker import ipqs_checker
                result = await ipqs_checker.check_ip(node.ip)
                
                if result.get('success'):
                    # Заполнить ВСЁ из одного запроса
                    if not node.country and result.get('country'):
                        node.country = result['country']
                    if not node.state and result.get('region'):
                        node.state = result['region']
                    if not node.city and result.get('city'):
                        node.city = result['city']
                    if not node.zipcode and result.get('zipcode'):
                        node.zipcode = result['zipcode']
                    if not node.provider and result.get('isp'):
                        node.provider = result['isp']
                    if node.scamalytics_fraud_score is None:
                        node.scamalytics_fraud_score = result.get('fraud_score', 0)
                    if node.scamalytics_risk is None:
                        node.scamalytics_risk = result.get('risk_level', 'low')
                    
                    logger.info(f"✅ IPQS complete: {node.ip} → City={node.city}, Fraud={node.scamalytics_fraud_score}")
                    return True
            except Exception as e:
                logger.error(f"IPQS complete check error: {e}")
                return False
        else:
            # Отдельные запросы для гео и fraud
            geo_success = await self.enrich_node_geolocation(node, db_session)
            fraud_success = await self.enrich_node_fraud(node, db_session)
            return geo_success or fraud_success

        """Обогатить узел геолокацией"""
        needs_geo = not node.city or not node.state or not node.zipcode
        
        if not needs_geo:
            return False
        
        result = await self.get_geolocation(node.ip)
        
        if result.get('success'):
            if not node.country:
                node.country = result.get('country', '')
            if not node.state:
                node.state = result.get('state', '')
            if not node.city:
                node.city = result.get('city', '')
            if not node.zipcode:
                node.zipcode = result.get('zipcode', '')
            if not node.provider:
                node.provider = result.get('provider', '')
            return True
        return False
    
    async def enrich_node_fraud(self, node, db_session):
        """Обогатить узел fraud данными"""
        needs_fraud = node.scamalytics_fraud_score is None or node.scamalytics_risk is None
        
        if not needs_fraud:
            return False
        
        result = await self.check_fraud(node.ip)
        
        if result.get('success'):
            if node.scamalytics_fraud_score is None:
                node.scamalytics_fraud_score = result.get('fraud_score', 0)
            if node.scamalytics_risk is None:
                node.scamalytics_risk = result.get('risk_level', 'low')
            return True
        return False

service_manager = ServiceManager()
